// Tray icon for Auto Step Climb (Windows).
//
// This is a small separate program so the app shows up under its own name in the tray and in Task
// Manager, instead of as "Node.js JavaScript Runtime". It only talks to the app's own dashboard on
// this PC (127.0.0.1): it reads /api/tray once a second, and its Quit item posts /api/quit, the same
// thing the dashboard's Quit button does. It has no access to the simulator. It removes its icon and
// closes a few seconds after the app does.
//
// src/tray.ts builds it on first start with the compiler that ships with Windows (csc.exe, .NET
// Framework 4), so this has to stay C# 5 and use only the framework's own libraries.
//
//   AutoStepClimb.exe --port 8787 [--pid N] [--logs DIR] [--hidden | --selftest | --quit]
//   AutoStepClimb.exe --render DIR
//
// --pid N closes the icon the moment that process (the app) ends. Without it, or if that fails, the icon
// closes after the app has stopped answering for a few seconds. --hidden does everything except show
// the icon. --selftest builds the icon and the menu, reads /api/tray once, prints what it would show as
// one line of JSON and exits. --quit sends the same request as the Quit item and prints the answer.
// --render writes each colour of the icon to DIR as a PNG, to look at. The tests use the last four, so
// running them never puts an icon in anyone's tray.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Auto Step Climb")]
[assembly: AssemblyProduct("Auto Step Climb")]
[assembly: AssemblyDescription("Tray icon for Auto Step Climb")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace AutoStepClimb
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            int port = 0;
            int pid = 0;
            string logs = null;
            string render = null;
            bool selfTest = false;
            bool quit = false;
            bool hidden = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--port" && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out port);
                    i++;
                }
                else if (args[i] == "--pid" && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out pid);
                    i++;
                }
                else if (args[i] == "--hidden")
                {
                    hidden = true;
                }
                else if (args[i] == "--logs" && i + 1 < args.Length)
                {
                    logs = args[i + 1];
                    i++;
                }
                else if (args[i] == "--render" && i + 1 < args.Length)
                {
                    render = args[i + 1];
                    i++;
                }
                else if (args[i] == "--selftest")
                {
                    selfTest = true;
                }
                else if (args[i] == "--quit")
                {
                    quit = true;
                }
            }
            if (render != null) return Render(render);
            if (port < 1 || port > 65535) return 2;
            Log.Dir = logs;

            if (selfTest) return SelfTest(port);
            if (quit) return Quit(port);

            bool first;
            using (Mutex single = new Mutex(true, "Local\\AutoStepClimbTray-" + port, out first))
            {
                if (!first) return 0; // there is already an icon for this port

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
                {
                    Log.Write("error: " + e.Exception);
                };
                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
                {
                    Log.Write("fatal: " + e.ExceptionObject);
                };

                Log.Write("started for port " + port + (pid > 0 ? ", watching process " + pid : "") + (hidden ? ", hidden" : ""));
                using (TrayApp app = new TrayApp(port, logs, true, !hidden, pid))
                {
                    Application.Run(app);
                }
                Log.Write("closed");
                return 0;
            }
        }

        private static int Quit(int port)
        {
            string message;
            bool ok = Api.PostQuit(port, out message);
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["ok"] = ok;
            result["message"] = message;
            Console.Out.WriteLine(new JavaScriptSerializer().Serialize(result));
            return ok ? 0 : 1;
        }

        private static int Render(string dir)
        {
            Directory.CreateDirectory(dir);
            foreach (string level in new string[] { "ok", "busy", "attention", "problem", "off" })
            {
                using (Icon icon = Painter.Make(level))
                using (Bitmap bmp = icon.ToBitmap())
                {
                    bmp.Save(Path.Combine(dir, level + ".png"), ImageFormat.Png);
                }
            }
            return 0;
        }

        private static int SelfTest(int port)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            bool ok = false;
            try
            {
                Dictionary<string, object> data = Api.GetJson(port, "/api/tray", 3000);
                using (TrayApp app = new TrayApp(port, Log.Dir, false, false, 0))
                {
                    app.Apply(data);
                    result["level"] = app.ShownLevel;
                    result["tip"] = app.ShownTip;
                    result["title"] = Api.Str(data, "title", "");
                    result["line"] = Api.Str(data, "line", "");
                    result["menu"] = app.MenuLabels();
                    result["icon"] = app.IconSize;
                }
                ok = true;
            }
            catch (Exception e)
            {
                result["error"] = e.Message;
            }
            result["ok"] = ok;
            Console.Out.WriteLine(new JavaScriptSerializer().Serialize(result));
            return ok ? 0 : 1;
        }
    }

    /// <summary>The icon, its menu, and the once-a-second look at what the app is doing.</summary>
    internal sealed class TrayApp : ApplicationContext
    {
        private readonly int port;
        private readonly string logs;
        private readonly Control ui = new Control();
        private readonly NotifyIcon notify = new NotifyIcon();
        private readonly ContextMenuStrip menu = new ContextMenuStrip();
        private readonly ToolStripLabel titleItem = new ToolStripLabel("Auto Step Climb");
        private readonly ToolStripLabel lineItem = new ToolStripLabel("Starting...");
        private readonly Dictionary<string, Icon> icons = new Dictionary<string, Icon>();
        private System.Threading.Timer timer;
        private int failures;
        private int polling;
        private bool closing;

        public string ShownLevel = "";
        public string ShownTip = "";

        public string IconSize
        {
            get { return notify.Icon == null ? "none" : notify.Icon.Width + "x" + notify.Icon.Height; }
        }

        /// <param name="poll">Keep reading the app (otherwise the caller feeds it one reading).</param>
        /// <param name="visible">Put the icon in the tray.</param>
        /// <param name="pid">Close the moment this process ends (0: not watching one).</param>
        public TrayApp(int port, string logs, bool poll, bool visible, int pid)
        {
            this.port = port;
            this.logs = logs;

            IntPtr handle = ui.Handle; // gives this thread something to post updates to
            if (handle == IntPtr.Zero) Log.Write("no window handle");

            titleItem.Font = new Font(titleItem.Font, FontStyle.Bold);

            ToolStripMenuItem open = new ToolStripMenuItem("Open dashboard");
            open.Font = new Font(open.Font, FontStyle.Bold);
            open.Click += delegate { OpenDashboard(); };
            ToolStripMenuItem folder = new ToolStripMenuItem("Open log folder");
            folder.Click += delegate { OpenLogs(); };
            ToolStripMenuItem quit = new ToolStripMenuItem("Quit Auto Step Climb");
            quit.Click += delegate { AskQuit(); };

            menu.Items.Add(titleItem);
            menu.Items.Add(lineItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(open);
            if (!String.IsNullOrEmpty(logs)) menu.Items.Add(folder);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(quit);

            notify.ContextMenuStrip = menu;
            notify.DoubleClick += delegate { OpenDashboard(); };
            ApplyIcon("off", "Auto Step Climb"); // Windows keeps the first hover text as the icon's name in its settings

            if (visible) notify.Visible = true;
            if (poll)
            {
                if (pid > 0) Watch(pid);
                timer = new System.Threading.Timer(OnTimer, null, 0, 1000);
            }
        }

        /// <summary>Closes the moment the app's process ends, which is quicker than waiting for it to stop answering.</summary>
        private void Watch(int pid)
        {
            try
            {
                Process app = Process.GetProcessById(pid);
                app.EnableRaisingEvents = true;
                app.Exited += delegate { CloseLater("the app exited"); };
                if (app.HasExited) CloseLater("the app exited");
            }
            catch (Exception)
            {
                CloseLater("the app is not running"); // no such process any more
            }
        }

        private void CloseLater(string why)
        {
            try
            {
                ui.BeginInvoke(new Action(delegate { Close(why); })); // waits in the queue if the window loop has not started yet
            }
            catch (Exception)
            {
                // closing already
            }
        }

        public List<string> MenuLabels()
        {
            List<string> labels = new List<string>();
            foreach (ToolStripItem item in menu.Items)
            {
                if (!(item is ToolStripSeparator)) labels.Add(item.Text);
            }
            return labels;
        }

        /// <summary>Shows what the app reported, or counts a miss when it reported nothing.</summary>
        public void Apply(Dictionary<string, object> data)
        {
            if (closing) return;
            if (data == null)
            {
                failures++;
                ApplyIcon("off", "Auto Step Climb: not answering");
                lineItem.Text = "Not answering";
                if (failures >= 3) Close("the app is gone"); // only when it is not being watched by its process id
                return;
            }
            failures = 0;
            titleItem.Text = Api.Str(data, "title", "Auto Step Climb");
            lineItem.Text = Api.Str(data, "line", "");
            ApplyIcon(Api.Str(data, "level", "off"), Api.Str(data, "tip", "Auto Step Climb"));
        }

        private void ApplyIcon(string level, string tip)
        {
            if (level != ShownLevel)
            {
                Icon icon;
                if (!icons.TryGetValue(level, out icon))
                {
                    icon = Painter.Make(level); // one per colour, kept for the life of the program
                    icons[level] = icon;
                }
                notify.Icon = icon;
                ShownLevel = level;
            }
            if (tip != ShownTip)
            {
                notify.Text = tip.Length <= 63 ? tip : tip.Substring(0, 60) + "..."; // Windows shows 63 characters
                ShownTip = tip;
            }
        }

        private void OnTimer(object state)
        {
            if (closing || Interlocked.Exchange(ref polling, 1) == 1) return;
            Dictionary<string, object> data = null;
            try
            {
                data = Api.GetJson(port, "/api/tray", 1500);
            }
            catch (Exception)
            {
                data = null;
            }
            finally
            {
                Interlocked.Exchange(ref polling, 0);
            }
            try
            {
                ui.BeginInvoke(new Action(delegate { Apply(data); }));
            }
            catch (Exception)
            {
                // closing
            }
        }

        private void Close(string why)
        {
            if (closing) return;
            closing = true;
            Log.Write("closing: " + why);
            if (timer != null) timer.Dispose();
            notify.Visible = false; // otherwise the icon lingers in the tray until the mouse passes over it
            notify.Dispose();
            ExitThread();
        }

        private void OpenDashboard()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port + "/") { UseShellExecute = true });
            }
            catch (Exception e)
            {
                Log.Write("could not open the dashboard: " + e.Message);
            }
        }

        private void OpenLogs()
        {
            try
            {
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + logs + "\"") { UseShellExecute = true });
            }
            catch (Exception e)
            {
                Log.Write("could not open the log folder: " + e.Message);
            }
        }

        private void AskQuit()
        {
            DialogResult answer;
            using (Form owner = new Form())
            {
                owner.TopMost = true; // so the question is never hidden behind the sim
                answer = MessageBox.Show(
                    owner,
                    "Quit Auto Step Climb?\r\n\r\nIt will stop flying step climbs until you start it again.",
                    "Auto Step Climb",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
            }
            if (answer != DialogResult.Yes) return;

            ThreadPool.QueueUserWorkItem(delegate
            {
                string message;
                if (Api.PostQuit(port, out message))
                {
                    Log.Write("quit asked: " + message); // the app closes, and this closes a few seconds after it
                    return;
                }
                try
                {
                    ui.BeginInvoke(new Action(delegate { notify.ShowBalloonTip(8000, "Auto Step Climb", message, ToolTipIcon.Warning); }));
                }
                catch (Exception)
                {
                    // closing
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (timer != null) timer.Dispose();
                notify.Dispose();
                menu.Dispose();
                ui.Dispose();
                foreach (Icon icon in icons.Values) icon.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    /// <summary>The app's own dashboard, on this PC only.</summary>
    internal static class Api
    {
        public static Dictionary<string, object> GetJson(int port, string path, int timeoutMs)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            req.Method = "GET";
            req.Proxy = null; // never through a proxy
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.KeepAlive = false;
            using (WebResponse res = req.GetResponse())
            using (StreamReader reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
            {
                return new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
            }
        }

        /// <summary>The same request as the dashboard's Quit button. The app refuses while a step is in progress.</summary>
        public static bool PostQuit(int port, out string message)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/quit");
                req.Method = "POST";
                req.Proxy = null;
                req.Timeout = 4000;
                req.ContentType = "application/json";
                req.Headers["X-Autostep"] = "1";
                byte[] body = Encoding.UTF8.GetBytes("{}");
                req.ContentLength = body.Length;
                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(body, 0, body.Length);
                }
                using (WebResponse res = req.GetResponse())
                {
                    message = "Closing";
                    return true;
                }
            }
            catch (WebException e)
            {
                message = e.Message;
                if (e.Response != null)
                {
                    try
                    {
                        using (StreamReader reader = new StreamReader(e.Response.GetResponseStream(), Encoding.UTF8))
                        {
                            Dictionary<string, object> data = new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                            message = Str(data, "error", message);
                        }
                    }
                    catch (Exception)
                    {
                        // keep the generic message
                    }
                }
                return false;
            }
            catch (Exception e)
            {
                message = e.Message;
                return false;
            }
        }

        public static string Str(Dictionary<string, object> data, string key, string fallback)
        {
            object value;
            if (data != null && data.TryGetValue(key, out value) && value != null) return value.ToString();
            return fallback;
        }
    }

    /// <summary>The icon: the dashboard's staircase, with a dot whose colour says how things are.</summary>
    internal static class Painter
    {
        public static Color Dot(string level)
        {
            switch (level)
            {
                case "ok": return Color.FromArgb(0x3d, 0xdc, 0x6e);        // waiting for the next step
                case "busy": return Color.FromArgb(0x38, 0xd5, 0xff);      // flying a step
                case "attention": return Color.FromArgb(0xff, 0xb0, 0x20); // needs a look: no sim, or waiting for you
                case "problem": return Color.FromArgb(0xff, 0x5c, 0x5c);   // a step failed
                default: return Color.FromArgb(0x8a, 0x94, 0xa3);          // off, or not answering
            }
        }

        public static Icon Make(string level)
        {
            Color ink = Color.FromArgb(0x0d, 0x12, 0x18);
            using (Bitmap bmp = new Bitmap(32, 32, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);

                    using (GraphicsPath tile = Rounded(1f, 1f, 30f, 30f, 7f))
                    using (SolidBrush fill = new SolidBrush(ink))
                    using (Pen edge = new Pen(Color.FromArgb(0x46, 0x5a, 0x6e), 1.4f))
                    {
                        g.FillPath(fill, tile);
                        g.DrawPath(edge, tile);
                    }

                    PointF[] stairs = new PointF[]
                    {
                        new PointF(5.5f, 25f), new PointF(12f, 25f), new PointF(12f, 18.5f),
                        new PointF(19f, 18.5f), new PointF(19f, 12f), new PointF(22f, 12f)
                    };
                    using (Pen pen = new Pen(Color.FromArgb(0xb4, 0xc6, 0xd8), 3.8f))
                    {
                        pen.LineJoin = LineJoin.Round;
                        pen.StartCap = LineCap.Round;
                        pen.EndCap = LineCap.Round;
                        g.DrawLines(pen, stairs);
                    }

                    using (SolidBrush dot = new SolidBrush(Dot(level)))
                    using (Pen ring = new Pen(ink, 1.6f))
                    {
                        g.FillEllipse(dot, 17.5f, 3.5f, 12f, 12f); // the colour is the message, so it is the biggest thing
                        g.DrawEllipse(ring, 17.5f, 3.5f, 12f, 12f);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private static GraphicsPath Rounded(float x, float y, float w, float h, float r)
        {
            float d = r * 2f;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(x, y, d, d, 180, 90);
            path.AddArc(x + w - d, y, d, d, 270, 90);
            path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            path.AddArc(x, y + h - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    /// <summary>A few lines in the app's log folder, so a missing icon can be explained.</summary>
    internal static class Log
    {
        public static string Dir;

        public static void Write(string text)
        {
            if (String.IsNullOrEmpty(Dir)) return;
            try
            {
                Directory.CreateDirectory(Dir);
                File.AppendAllText(Path.Combine(Dir, "tray.log"), DateTime.UtcNow.ToString("o") + " " + text + "\r\n");
            }
            catch (Exception)
            {
                // a log must never cause trouble
            }
        }
    }
}
