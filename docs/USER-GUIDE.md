# Auto Step Climb: summary and user guide

Version 0.10.2 (beta), for Microsoft Flight Simulator 2024 on Windows.

This guide has two parts: a summary of what the tool is and does, then a step-by-step guide to using it. It is
written for people who fly, not for programmers. Where a word needs explaining, it is explained.

------------------------------------------------------------------------------------------------------

## Part 1: The tool at a glance

### What it is

Auto Step Climb is a small Windows program that looks after the step climbs of a long flight. A step climb is a
climb to a higher cruise level part-way along a long route, because the aircraft gets lighter as it burns fuel
and can fly higher and more efficiently. SimBrief plans them for you; this program uses that plan.

It lives in the system tray (the small icons by the clock). You do not start it before a flight. When Microsoft
Flight Simulator is running and your aircraft is on the ground at an airport, it fetches your latest SimBrief
flight plan and opens its window behind the sim.

### The two things it can do

1. **Fly the step climbs of the iniBuilds A330 for you.** At each step point it sets the FCU altitude to the
   new level and starts the climb, the way you would: turn the altitude knob, then push it (a managed climb)
   or pull it (an open climb). Leave the cruise alone, or sleep through it.

2. **Ask BeyondATC for the step climbs in other aircraft.** For aircraft the program does not control, such
   as the iniBuilds A350, A340, A320neo and A321LR, the PMDG 777 and 737, the Fenix A320 family, the
   FlyByWire A32NX and A380X, and the Headwind A339X, it asks BeyondATC for the new level a little before each
   step point and tells you what the controller said. It sends nothing to the aircraft. The aircraft climbs by
   itself (several have an automatic step climb option) or you climb it.

   Why this helps: BeyondATC only changes your cleared level when you ask for a new one, so a climb that
   nobody asked for goes unnoticed. This asks for you.

### What it never does

- It does not touch an aircraft it has no controls for. In those aircraft it only reads the position and the
  altitude, and talks to BeyondATC.
- It does not climb the A330 until you switch on **Live control** in Settings. Until then it is "watching
  only": it reads the sim and writes down what it would do.
- It does not act below cruise, far from the planned route, or when something looks wrong. Anything unexpected
  makes it do less, never more.
- It sends nothing about you anywhere. The only thing that leaves your PC is the request for your latest flight
  plan to simbrief.com, with your SimBrief username. There is no account, no tracking and no update check.

### What you need

- Windows 10 or 11, 64-bit.
- Microsoft Flight Simulator 2024 (Steam or Microsoft Store).
- A free SimBrief account. Generate your flight plan with the detailed navlog.
- For the automatic climbs: the iniBuilds A330 (-200 or -300).
- For BeyondATC requests: BeyondATC, running on the same PC as the sim.
- Nothing else. No MobiFlight and no other add-on is needed.

### How much it costs your PC

About 55 MB of memory while it waits in the tray, no graphics card use, and well under 1% of one processor
core. It runs at low priority so the sim always comes first.

------------------------------------------------------------------------------------------------------

## Part 2: How to use it

### 1. Install it (once)

1. Unzip the download and run `AutoStepClimb-Setup-0.10.2.exe`.
2. Windows may say "Unknown publisher", because the installer is not code-signed. Click **More info**, then
   **Run anyway**. It installs for your user only and needs no administrator rights.
3. The first time it opens it asks whether it may start with Windows. Say yes: that is how it is already
   waiting in the tray when you load your aircraft. You can change this later in Settings.
4. Open the window (click its tray icon), click **Settings** at the bottom, type your **SimBrief username**
   and press **Save**.

That is all. There is nothing to start before a flight.

To remove it: Windows Settings, Apps, Auto Step Climb, Uninstall. Your settings and logs stay in
`%APPDATA%\Auto Step Climb` until you delete that folder.

To update, unzip the new version and run its installer over the old one. Your settings and logs stay. The
program never checks for updates by itself, so look at the download page now and then.

### 2. Before each flight

1. Generate your flight plan in SimBrief with the detailed navlog. The program finds the step climbs in it: the
   places where the planned cruise level goes up.
2. Load your aircraft at an airport and wait a few seconds. The window opens by itself, behind the sim (it does
   not take the keyboard from the sim; use the taskbar, Alt+Tab or a second screen to look at it). A
   notification names the airport, for example "A330 ready at EGLL".
3. Look at the **Plan** table in the window. The steps and their levels should match your SimBrief plan. If
   you were parked at an airport the plan does not start or end at, the window warns you.
4. You can generate a newer plan at the gate: while the aircraft is parked it checks SimBrief once a minute
   and switches to a newer plan. In the air it never swaps the plan it is flying.

To fly a step you can also type steps yourself in the **Steps** box, one per line as `WAYPOINT/FL` (for
example `ARKIN/370`), the same form the MCDU's STEP ALTS page takes.

### 3. The window, part by part

**The chips at the top.** They show the mode (Watching only, Live, or Asking BeyondATC), whether the sim is
connected, where the aircraft is parked, your flight's name from SimBrief (such as ALK607), and whether
BeyondATC can be reached. **Cockpit look** switches between a plain look and a black-glass look. **Quit app**
closes the program (it asks first, and it does not touch the aircraft).

**The banner under the chips** says what the program will and will not do right now. Read it: "Watching only"
means it will NOT climb your aircraft.

**The status card.** The badge shows what it is doing (Waiting, Armed, Setting FCU, Climbing, and so on). The
big line says what is next ("LIBTU FL380 in 868 NM"). Below it are the next step, the distance to it (with the
time at your speed), and how far you are off the planned route. The chart is the plan as a staircase of cruise
levels, drawn to scale along your route, with your aircraft on it. The **Automatic / Asks ATC / Watching only**
line says how steps will start. The buttons:

- **Confirm step** appears when it waits for your OK (Confirm each step).
- **Step now** starts the next step now, ahead of its step point (A330 only).
- **Skip next** skips the next step.
- **Reload OFP** fetches your SimBrief plan again.
- **Control test** checks the A330's FCU by moving it one click and back (A330 only, with Live control on).
- **Stop** ends whatever is in progress and sends nothing further. It leaves the FCU as it is, so check it.

**The Aircraft card** shows the aircraft's title and live readings (altitude, vertical speed, Mach, ground
speed, weight, the FCU altitude, the autopilot target), with a badge saying whether the program controls it.

**The Plan card** lists each step with its level, status (Pending, Done, Skipped, Failed) and a note saying
why. It warns you when the aircraft is parked somewhere the plan does not start or end; the log warns when the
plan is more than a day old.

**The Steps card** has the Steps box and three switches: **Fly step downs**, **Ask BeyondATC first**
(with **Climb anyway if BeyondATC does not clear it** under it) and **Ask BeyondATC for the steps in other
aircraft**.

**The Log card** records everything it did and why, so a flight left running overnight can be read in the
morning.

**The Settings card** (at the bottom) holds your SimBrief username, **Live control**, **Confirm each step**,
**Open this window at the airport**, **Start with Windows**, **Open log folder**, **Open settings file**,
**Copy report** and **Report a problem**.

### 4. Flying the iniBuilds A330 with it

**First: it starts watching only.** For its first flight it reads the sim and logs what it would do, but it
will not climb your aircraft. This is on purpose. The banner says so.

**To let it fly the steps:** open Settings, switch **Live control** on and confirm. The A330 profile that comes
with the program is marked verified, so nothing else is needed. The **Control test** button is still there if
you want to check the FCU on your own sim: it changes the FCU altitude by one click and back and checks that
it followed. It does not change the autopilot mode.

**Your first live flight: treat it as a test.** The program's flying logic was flown live on a real overnight
flight (San Francisco to Nadi) and both step climbs worked. The Windows app around it has been checked
against a simulated aircraft. So for the first step, turn on **Confirm each step** in Settings: the program
then waits at the step point and you press **Confirm step** after checking the FMA (it should show CLB after
the push; OP CLB means the open climb ran). Do it in a quiet moment, not in busy airspace, and turn Confirm
each step off again afterwards.

**What to set up in the aircraft.** The program only operates the FCU (altitude knob, push, pull). The MCDU
stays yours. Set the aircraft up as for any managed flight:

1. An active flight plan, loaded the usual way (SimBrief ID in the EFB settings, download the OFP, press INIT
   REQ). Check the F-PLN page against the OFP.
2. INIT B filled in (ZFW and block fuel), so the aircraft can compute its climb profile.
3. CRZ FL equal to the OFP's first cruise level, and the PERF pages done as usual.
4. In the cruise: autopilot on, autothrust active with the thrust levers in the CLB detent, and the FCU on the
   cruise level.

A managed climb needs the flight plan. Without one nothing climbs after the push, so after 25 seconds the
program tries the open climb. STEP ALTS in the MCDU is optional; the program cannot read it, so the steps it
flies are the ones in its Steps box.

**What happens at a step point.** Once you have been level for a minute and you reach the step point it:

1. sets the FCU altitude to the new level, clicking the knob and reading the FCU back after every click;
2. pushes the knob (a managed climb), or pulls it if the push starts nothing;
3. watches the climb, and marks the step Done when the aircraft levels at the new altitude.

If the FCU does not respond or no climb starts, it puts the FCU back where it was. If a climb stalls part-way
it levels off where it is. It never retries on its own.

**If you climb yourself** before the step point, it sees the new altitude and skips that step instead of
fighting you.

**Notifications.** A quiet Windows notification (no sound) tells you when a step starts, is complete, fails, is
held back for weight or is skipped. While the program only watches, it tells you that a step was not flown and
how to change that.

**Long flights and sleeping through them.** Leave **Confirm each step** off (the default), make sure **Live
control** is on, load the fuel and payload from the OFP too (a step is held while the aircraft is more than 3%
heavier than the OFP planned), and do not let the PC sleep. The window can be closed: the program keeps flying
the steps from the tray. In the morning, the Plan card and the log show what was done, skipped or failed.

**On VATSIM or IVAO**, get your step clearance first and use **Confirm each step**. The program cannot request
a step from a human controller.

### 5. Other aircraft: BeyondATC requests

This is for any aircraft the program does not control: the iniBuilds A350, A340, A320neo and A321LR, the PMDG
777 and 737 families, the Fenix A319/A320/A321, the FlyByWire A32NX and A380X, the Headwind A339X, and any
other. It works with any aircraft because it only reads the aircraft's position and altitude.

**Set it up (once):**

1. Start BeyondATC on this PC. In BeyondATC, turn on **Auto Respond** (its copilot reads ATC back for you) and
   **Auto Tune** (it keeps the radio on the right frequency).
2. In the program's window, under **Steps**, switch on **Ask BeyondATC for the steps in other aircraft**.

**On each flight:**

1. Generate your SimBrief plan and load your aircraft. The window opens at the airport as it does for the A330
   and says **Asking BeyondATC** at the top.
2. In stable cruise, about 10 NM before each step point, the program asks BeyondATC for the new level: it
   chooses *Request Altitude Change* and then the level from BeyondATC's menu, the way you would.
3. It tells you what the controller said, as a line in the log and a Windows notification: "BeyondATC cleared
   FL380" or "BeyondATC did not clear FL380". If ATC refuses or says nothing it asks once more after two
   minutes.
4. The aircraft climbs by itself (if it has an automatic step climb switched on), or you climb it. When the
   aircraft is at the new level the step shows as Done.

**Good to know:**

- It never sends anything to the aircraft, so it cannot start a climb and it cannot stop one. If BeyondATC says
  no and your aircraft is about to climb by itself, switch the aircraft's automatic step climb off yourself.
  The iniBuilds A340 guide, for example, recommends switching automatic step climb off in controlled airspace
  online (in that aircraft it is under EFB Settings, Aircraft Settings, AUTO STEP CLIMB). Check your own
  aircraft's manual for where its option is.
- Ten nautical miles is about 75 seconds at cruise speed, and asking can take up to two minutes, so an
  automatic step climb may start before BeyondATC has answered. The answer still shows when it arrives. To ask
  earlier, raise `engine.atcOtherLeadNm` in the settings file (see below).
- BeyondATC has to be running, with a controller tuned in the cruise, for it to answer. If BeyondATC is not
  running the window says so ("BeyondATC not found") and tells you once per step.
- Live control is about the A330's FCU. This mode works with it on or off.
- This mode is new. It has been tried against a simulated aircraft and a pretend BeyondATC, and has not been
  flown in each of the aircraft named above. Treat your first flight with it as a test.

### 6. Asking BeyondATC before the A330 climbs

For the A330 there is a stricter option. Switch on **Ask BeyondATC first** (Steps card) and the program asks
for each step, and only climbs once the controller has cleared it. On the radio it goes like this: your pilot
says "request altitude change"; the controller says "say again altitude" (that is normal); about ten seconds
later a menu of levels appears in BeyondATC and the program chooses the level; the pilot says "request FL380";
the controller answers with the new cruise altitude, and the program climbs.

If ATC refuses or does not answer, it asks once more after two minutes, then skips the step. It never climbs
without a clearance.

Under it, **Climb anyway if BeyondATC does not clear it** (off by default) changes that for a flight on your
own: when BeyondATC cannot be asked, or still has not cleared the step after the second try, the step is
climbed anyway. Turning it on asks you to confirm. Leave it off on VATSIM or IVAO.

BeyondATC has no official connection for other programs. The program uses the local connection that BeyondATC's
own toolbar uses (this PC only), so a BeyondATC update could change it. If that happens it simply cannot ask,
and the step waits or is skipped.

### 7. The tray icon

Look under the **^** arrow next to the clock, and drag the icon onto the taskbar if you want it always
showing. Click it to open the window.

The dot's colour says what is going on:

- green: waiting for the next step;
- cyan: flying a step, or asking BeyondATC;
- amber: needs a look (no sim yet, an aircraft it does not follow, or waiting for you to confirm a step);
- red: a step failed;
- grey: switched off (the **Auto step climb** switch in the window is off).

Right-click the icon for a menu: the current status, **Open window**, **Start with Windows**, **Open log
folder**, **Copy report for a bug report**, and **Quit**. Closing the window with the X leaves the program
running in the tray.

### 8. Settings you can change

In the window (Settings card and Steps card):

- **SimBrief username**: whose latest plan to fetch.
- **Live control**: lets the program operate the A330's FCU. Off means watching only.
- **Confirm each step**: wait for you to press Confirm step at every step point, and skip the step if nobody
  does.
- **Open this window at the airport**: turn off to keep the window closed (the tray icon still changes).
- **Start with Windows**: wait in the tray after you sign in.
- **Fly step downs**: also fly the plan's step descents. Off: the aircraft stays at the higher level.
- **Hold a step while the aircraft is too heavy**: the weight check, on by default. Turn it off only if you want a
  step flown whatever the aircraft weighs (it asks you to confirm).
- **Open the guide**: this guide, which is installed next to the program.
- **Ask BeyondATC first**, **Climb anyway if BeyondATC does not clear it**, and **Ask BeyondATC for the steps in
  other aircraft**, as above.

More options live in `config.json` in `%APPDATA%\Auto Step Climb` (**Open settings file** in the window). The
window writes its own settings back to the file without disturbing the rest, and changes you make by hand apply
the next time the program starts. A few you may want:

- `engine.atcOtherLeadNm` (default 10): how many NM before the step point it asks BeyondATC in other aircraft.
- `engine.atcLeadNm` (default 10): the same for the A330 with Ask BeyondATC first.
- `engine.maxCrossTrackNm` (default 30): pause when this far off the planned route.
- `engine.lateWindowNm` (default 40): still start up to this far after the step point, then skip the step.
- `engine.weightToleranceFrac` (default 0.03): how much heavier than the plan counts as too heavy.
- `engine.climbMode` (`managed` or `open`): use `open` if you fly without a flight plan in the aircraft.
- `planFile`: use a saved SimBrief OFP file instead of fetching.

### 9. Safety: what it checks and refuses

- It acts only in stable level cruise (above 20,000 ft), within 30 NM of the planned route, for steps of up to
  4,000 ft, and never above 41,000 ft.
- It holds a step while the aircraft is more than 3% heavier than the plan says it should be there (a switch in
  the Steps card turns this check off).
- If you pause the sim it notices (the aircraft stops moving in the air), stops its own clock and sends nothing
  until the sim runs again, so a step in progress carries on afterwards.
- It checks every FCU command against the next reading from the sim, and never assumes a command worked.
- If the sim stops answering in the middle of a step, the step is abandoned rather than continued blind.
- **Stop** ends whatever is in progress and sends nothing further.
- Opening, hiding or closing the window never changes what the program is doing. The window cannot reach the
  network.
- An aircraft with no profile is never controlled.

### 10. When something does not look right

What the line under the big heading can say, and what to do:

- **Waiting for the simulator**: the sim is not running or not answering yet.
- **Unsupported aircraft ... (no profile ...)**: this is not an aircraft the program flies. For BeyondATC
  requests in it, switch on **Ask BeyondATC for the steps in other aircraft**.
- **No flight plan yet: enter your SimBrief username in Settings**: set your username and press Save, then
  generate a plan in SimBrief.
- **The sim is paused**: the aircraft is standing still in the air. The program waits and sends nothing; a step in
  progress carries on when the sim runs again.
- **Waiting for stable cruise before ...**: it waits until you have been level for a minute above 20,000 ft.
- **... in 868 NM**: counting down to the step point. **STEP AHEAD** means it is close.
- **Off the planned route by 45 NM - steps paused**: you are more than 30 NM from the plan; it resumes when you
  are back on it.
- **Holding ...: 4.2% heavier than the OFP planned**: the weight check. Load the plan's fuel and payload, or
  press **Skip next**, or use **Step now** to override (A330).
- **ATC is not connected**: BeyondATC is not running or not reachable on this PC.
- **Skipped ...** with a reason: "passed 40 NM ago" (you went by the step point), "already at or above FL360"
  (you climbed yourself), "more than the 4000 ft step limit", "step downs are switched off", or "ATC did not
  clear FL360".
- **Failed ...**: "The FCU did not reach the target in time", "No climb after the climb command (is the
  autopilot on?)" or "climb stalled". Check the FCU yourself, then see the log.

If the window does not open, it opens behind the sim: look in the taskbar, or click the tray icon. If the tray
icon is missing, look under the **^** arrow by the clock.

### 11. Reporting a problem

1. Open the window and click **Settings** at the bottom.
2. Press **Copy report**. It puts the versions, your plan, what the program was doing and the last log lines
   on your clipboard, with your SimBrief name and your Windows user name blanked out. The program sends nothing
   by itself.
3. Press **Report a problem**. It opens the bug report form on GitHub. Paste the report into the box and say
   what you expected and what happened.

No GitHub account? Leave a comment on the download page instead and paste the report into it.

If the window will not open at all, the log is in `%APPDATA%\Auto Step Climb\logs\autostep.log` (the tray
menu has **Open log folder**). Attach it to the report.

### 12. Where things are

- The program: `%LOCALAPPDATA%\Programs\Auto Step Climb`. Aircraft profiles are in its `profiles` folder.
- Your settings and logs: `%APPDATA%\Auto Step Climb` (`config.json`, `logs\autostep.log`).
- Your own aircraft profiles go in `%APPDATA%\Auto Step Climb\profiles`, so an update never overwrites them.

### 13. Limits worth knowing

- It cannot read the MCDU or FMS, so the step points come from your SimBrief plan. If you change the steps in
  the MCDU, change the Steps box to match.
- A managed climb needs the flight plan loaded in the aircraft's FMS.
- The A330 climbs were flown live with the command-line version of this program from San Francisco to Nadi.
  The Windows app, and the BeyondATC requests for other aircraft, are newer and checked against simulated
  aircraft: reports from real flights are very welcome.
- The installer is not code-signed, so Windows shows "Unknown publisher". The program is free and its licence
  is MIT.
- It is not made by or affiliated with SimBrief, Navigraph, Microsoft, Asobo, iniBuilds, PMDG, Fenix Simulations,
  FlyByWire Simulations, Headwind Simulations or BeyondATC.

The source code is public: https://github.com/adhyanmavuri-tech/auto-step-climb

Bug reports and requests: https://github.com/adhyanmavuri-tech/auto-step-climb/issues
