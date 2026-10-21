AUTO STEP CLIMB for Microsoft Flight Simulator 2024
Step climbs for the iniBuilds A330, straight from your SimBrief flight plan.

INSTALL
  1. Run AutoStepClimb-Setup-<version>.exe and follow the steps.
     (Windows may say "Unknown publisher" because the installer is not code-signed:
      click "More info", then "Run anyway".)
  2. When it opens, say whether it may start with Windows. That is how it is
     already waiting in the system tray when you load the A330.
  3. Open Settings (the card at the bottom of the window) and type your SimBrief username.

USE
  Nothing to start. When your A330 is on the ground at an airport, the app fetches your
  latest SimBrief flight plan and opens its window behind the sim, without taking the
  keyboard from it. It then flies each step climb of the plan by turning the FCU altitude
  knob and pushing it (a managed climb).

  It starts WATCHING ONLY: it reads the sim and logs what it would do, but it will NOT climb
  your aircraft. Turn on "Live control" in Settings when you want it to operate the FCU.

  OTHER AIRCRAFT. For any aircraft other than the A330 (the A350, A340, 777, 737, the
  Fenix and FlyByWire Airbuses and more), turn on "Ask BeyondATC for the steps in other
  aircraft" under Steps in the window. The app then asks BeyondATC for each step about
  10 NM before the step point and tells you the answer. It sends nothing to the aircraft:
  the aircraft climbs by itself, or you climb it. BeyondATC has to be running.

  Closing the window does not stop it. It keeps working from the tray icon; quit it from there.

NEEDS
  Windows 10 or 11 (64-bit), Microsoft Flight Simulator 2024, the iniBuilds A330 (for the
  automatic climbs; any other aircraft works for BeyondATC requests), and a SimBrief
  account (free). Optional: BeyondATC, to ask for each step first. No MobiFlight or other
  add-on is needed.

GUIDE
  USER-GUIDE.txt (in this folder) is the full guide: what the tool does, how to set it up for
  the A330 and for other aircraft, the window part by part, the settings, and what the
  messages mean.

PROBLEMS?
  Open the window (click the tray icon), click Settings at the bottom and press "Copy report". It puts the
  versions, your plan, what the app was doing and the last log lines on your clipboard, with your SimBrief
  name and Windows user name blanked out. Then press "Report a problem" (it opens the bug report form) and
  paste the report in. The page is https://github.com/adhyanmavuri-tech/auto-step-climb/issues. The app never
  sends anything by itself. No GitHub account? Comment on the flightsim.to page and paste the report there.

UPDATE
  Run the new installer over the old one. Your settings and logs stay.

REMOVE
  Windows Settings > Apps > Auto Step Climb > Uninstall. Your settings and logs stay in
  %APPDATA%\Auto Step Climb unless you delete that folder.

Licence: MIT (LICENSE.txt). Other software in the app: THIRD-PARTY-NOTICES.txt (GPL-3.0.txt is the GNU licence
text that one of its parts builds on).
Source code: https://github.com/adhyanmavuri-tech/auto-step-climb
