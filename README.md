# Auto Step Climb: bug reports and requests

[Auto Step Climb](#about) flies the step climbs of your SimBrief flight plan in the iniBuilds A330 for Microsoft
Flight Simulator 2024. It waits in the system tray and opens by itself when your A330 is on the ground at an airport.

This page is for **bug reports and feature requests**.

## Report a bug

1. In the app, open the window (click the tray icon) and click **Settings** at the bottom.
2. Press **Copy report**. That puts the versions, your plan, what the app was doing and the last log lines on your
   clipboard, with your SimBrief name and Windows user name blanked out. The app sends nothing by itself.
3. Open **Issues**, then **New issue**, then **Bug report**, and paste the report into the **Report from the app**
   box. Say what you expected and what happened in the first box.

If the window will not open, the log is in `%APPDATA%\Auto Step Climb\logs\autostep.log` (Settings has an **Open log
folder** button, and so does the tray icon's menu). Attach it to the issue instead.

Please look at the open issues first: someone may have reported the same thing.

## Before you report

- It starts in **dry run**: it reads the sim and logs what it would do, and sends nothing. If a step did not happen,
  check that **Live control** is on, and that the profile's controls passed the **Control test** (a button in the
  window).
- The A330 controls are not marked verified yet. Reports from real flights are exactly what is needed.
- It cannot read the MCDU. The steps come from your SimBrief plan; if you changed them in the MCDU, change the
  **Steps** box in the window to match.

## About

- Windows 10 or 11 (64-bit), Microsoft Flight Simulator 2024, the iniBuilds A330, a free SimBrief account. BeyondATC is
  optional.
- Everything runs on your PC. The only thing that leaves it is the request for your latest plan to simbrief.com, with
  your SimBrief username. No account, no telemetry, no update checks.
- MIT licence.
