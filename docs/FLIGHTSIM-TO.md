# flightsim.to listing: Auto Step Climb

The text for the upload page, ready to paste. Things only you can decide are marked **[YOU]** and listed at the
end under *Before you upload*.

## File to upload

`release\AutoStepClimb-0.10.0.zip` (about 75 MB). It holds the installer (`AutoStepClimb-Setup-0.10.0.exe`), a
short `README.txt`, the full guide `USER-GUIDE.txt` (the source is `docs\USER-GUIDE.md`), `LICENSE.txt` and
`THIRD-PARTY-NOTICES.txt`. flightsim.to takes archives, not bare installers.

SHA-256, so people can check what they downloaded (from the build on 2026-10-18):

```
zip        cd183227df68e9ed19600baad51913b609ca068e00f30f18e1e172c3d6d6c6bf
installer  2ae70de5043e3d0a8f9cc7acb18cc7c9507e6dd60601e860842eb68cbe714ad0
```

## Title

Auto Step Climb: SimBrief step climbs for the iniBuilds A330, and BeyondATC step requests for other aircraft (MSFS 2024)

## Short description

Flies the step climbs of your SimBrief plan in the iniBuilds A330, and asks BeyondATC for the step climbs of other
aircraft: the A350, A340, 777, 737, the Fenix and FlyByWire Airbuses and more. It waits in the tray and opens by
itself when you are at the airport.

## Category and tags

Category: Utilities (the closest one: it is a companion program, not a Community-folder mod). **[YOU]** pick the
sub-category that fits on the upload form.

Tags: step climb, SimBrief, BeyondATC, iniBuilds, A330, A350, A340, PMDG, 777, 737, Fenix, FlyByWire, long haul,
MSFS 2024 (use as many as the form allows, in this order)

Version: 0.10.0 (beta)

## Description

**Fly the long haul and let the step climbs fly themselves.**

Auto Step Climb reads the step climbs from your SimBrief flight plan and, at each step point, sets the FCU
altitude to the new level and starts the climb in the iniBuilds A330 (managed, with an open climb as the
fallback), the way you would. Leave the cruise alone, or sleep through it.

**New: BeyondATC requests for other aircraft.** Many airliners climb to the next level by themselves at the step
point (the iniBuilds A340 and A350 and the PMDG 777 have an automatic step climb option, for example), and with the
others you climb yourself. BeyondATC only changes your cleared level when you ask for a new one, so nothing tells
it. Switch on **Ask BeyondATC for the steps in other aircraft** and the app asks for you, about 10 NM before each
step point, then tells you what the controller said with a notification ("BeyondATC cleared FL380"). It works with
any aircraft, because it only reads the aircraft's position and altitude: no profile and no add-on, not even
MobiFlight. It is aimed at the iniBuilds A350, A340, A320neo and A321LR, the PMDG 777 and 737 families, the Fenix
A319/A320/A321, the FlyByWire A32NX and A380X and the Headwind A339X. In those aircraft it **never sends anything to
the aircraft**: it only asks BeyondATC and tells you.

**You never start it.** It waits quietly in the system tray (about 55 MB of memory, no graphics card, well under 1%
of one processor core, and it yields to the sim). When Microsoft Flight Simulator is running and your A330 is on the
ground at an airport, it
fetches your latest SimBrief plan and opens its window *behind* the sim, without taking the keyboard from it, and
a notification says where it is: "A330 ready at EGLL". It does not start with the sim. In an aircraft other than the
A330 it does nothing unless you switch on the BeyondATC requests above.

**What you see**

- Your flight's name from SimBrief (the callsign, such as ALK607) at the top, and the plan as a staircase of cruise
  levels drawn to scale along your route, with your aircraft on it where the sim says it is (it creeps toward each
  step as you fly), the distance to the next step and the weight check, in a plain look (light or dark like Windows)
  or a black-glass cockpit look.
- A log of everything it did and why, so a flight left running overnight can be read in the morning.
- A tray icon whose dot is the state: green waiting, cyan flying a step, amber needs a look, red a step failed.
- A **Copy report** button for bug reports: one block of text (versions, plan, what it was doing, the last log
  lines) with your SimBrief name and Windows user name blanked out. It sends nothing by itself.

**Safe by default**

- It starts **watching only**: it reads the sim and logs what it would do, but it will not climb your aircraft (the
  window says so at the top). Turn on **Live control** in Settings when you want it to operate the FCU; it asks you
  to confirm.
- It acts only in stable level cruise, within 30 NM of the planned route, for steps of up to 4,000 ft, and holds a
  step while the aircraft is heavier than the OFP planned. Anything unexpected makes it do less, never more.
- **Stop** ends whatever is in progress. **Confirm each step** makes it wait for you at every step point.

**BeyondATC (optional).** Turn on **Ask BeyondATC first** and it requests each new level from BeyondATC like you
would, and only climbs once the controller has cleared it. If BeyondATC doesn't clear a step, the step is skipped:
a switch, **Climb anyway if BeyondATC does not clear it** (off by default), lets a flight on your own climb anyway.
In other aircraft, **Ask BeyondATC for the steps in other aircraft** asks for the new level and tells you the
answer; it never climbs anything.

**Private.** The only thing that leaves your PC is the request for your latest flight plan to simbrief.com, with
your SimBrief username. No account, no telemetry, no update checks.

## Requirements

- Windows 10 or 11, 64-bit
- Microsoft Flight Simulator 2024 (Steam or Microsoft Store)
- The iniBuilds A330 (-200 or -300) for the automatic climbs. Any other aircraft works for BeyondATC requests only
- A free SimBrief account (generate the OFP with the detailed navlog)
- Optional: BeyondATC (needed for the requests in other aircraft)

## Installation

1. Unzip, run `AutoStepClimb-Setup-0.10.0.exe`. Windows may say "Unknown publisher" because the installer is not
   code-signed: click **More info**, then **Run anyway**. It installs for your user only, with no administrator
   rights.
2. On first start it asks whether it may start with Windows. Say yes: that is how it is waiting when you load the
   A330.
3. Open **Settings** (the card at the bottom of the window), type your SimBrief username, press Save.
4. Fly. Load the A330 at an airport and the window opens. For any other aircraft, switch on **Ask BeyondATC for the
   steps in other aircraft** (under *Steps* in the window) first, and have BeyondATC running.

Uninstall from Windows Settings, Apps. Settings and logs stay in `%APPDATA%\Auto Step Climb`.

## Please read: this is a beta

- **The A330 controls are marked verified**, so Live control works without a test. The **Control test** button
  (it changes the FCU altitude by one click and back and checks it followed) is still there if you want to check
  your own sim. For your first real flight it is still wise to keep **Confirm each step** on and watch the FMA.
- The step logic and the SimConnect connection were flown live on a real overnight flight from San Francisco to
  Nadi (KSFO to NFFN) with the command-line version of this program: both planned step climbs were flown (the
  first with the managed push, the second needed the open pull). The Windows app around it (the window, tray,
  launch at the airport, installer) is checked against a simulated aircraft. Reports from real flights are very
  welcome.
- **BeyondATC requests for other aircraft are new.** They have been tried against a simulated aircraft and a pretend
  BeyondATC, not flown in each of the aircraft named above, so treat your first flight with them as a test. BeyondATC
  has to be running, with a controller tuned in the cruise, for it to answer. The app cannot stop an aircraft's own
  automatic step climb: if BeyondATC does not clear a step and you do not want the climb, switch the aircraft's
  automatic step climb off.
- It cannot read the MCDU, so the steps come from your SimBrief OFP. If you change the steps in the MCDU, change
  the Steps box in the window to match.
- On VATSIM or IVAO get your step clearance first, and use **Confirm each step**. It cannot request a step from a
  human controller.
- A managed climb needs the flight plan loaded in the aircraft's FMS (INIT B filled in, CRZ FL set).

## Changelog

**0.10.0 (beta)** First public release: the Windows app (tray, launch at the airport, window, settings, installer)
on the step-climb engine that was flown in a real overnight flight; SimBrief plans with newer-plan pickup at the
gate; BeyondATC clearance for each step; watching only until you turn Live control on. New in this version:
BeyondATC requests for other aircraft (the iniBuilds A350, A340, A320neo and A321LR, the PMDG 777 and 737, the Fenix
A320 family, the FlyByWire A32NX and A380X, the Headwind A339X and any other): the app asks BeyondATC for each step
before the step point and tells you the answer, and sends nothing to the aircraft.

## Credits and licence

MIT licence (`LICENSE.txt` in the zip). Uses Electron, node-simconnect (LGPL, replaceable: see
`THIRD-PARTY-NOTICES.txt`) and the public-domain OurAirports data. Not made by or affiliated with SimBrief,
Microsoft, Asobo, iniBuilds or BeyondATC.

Bug reports and requests: https://github.com/adhyanmavuri-tech/auto-step-climb/issues (a form asks for the details).
In the app, **Settings, Copy report** puts the details on the clipboard and **Report a problem** opens the form to
paste them into.

## Screenshots

In `docs\screenshots\`, made from the build in this listing (they show a real long-haul plan, KSFO to NFFN, flight
FIJ871, flown by a simulated aircraft, which is why the banner says Preview; picture 06 is a simulated aircraft that
the app does not control, with a pretend BeyondATC):

| File | Caption |
| --- | --- |
| `01-step-in-progress.png` | A step in progress: the plan as a staircase drawn to scale along the route, the aircraft part-way up the first climb, and the buttons |
| `02-cockpit-look.png` | The black-glass cockpit look, with the aircraft's readings and the distance to the next step |
| `03-log-and-settings.png` | The log and the Settings card: SimBrief username, Live control, Confirm each step, open at the airport, start with Windows, Copy report |
| `04-step-done.png` | Both steps flown: the staircase complete, the aircraft at the new level |
| `05-narrow-window.png` | The window at a narrow width (it works on a second screen or a tablet-sized window) |
| `06-asks-beyondatc-only.png` | BeyondATC requests for another aircraft: "Cleared by BeyondATC: 32N135W FL380 in 35 NM". The app asked BeyondATC ahead of the step point and sends nothing to the aircraft, which climbs by itself or is climbed by you |

## Before you upload

**[YOU]** decisions and things only you can do:

1. **Licence.** `LICENSE` is MIT with your name, to match RoutePilot. Change it before uploading if you want
   something else.
2. **Bug report page.** Done: https://github.com/adhyanmavuri-tech/auto-step-climb is public, with a bug report
   form and a feature request form, and the window's **Report a problem** button opens it (`docs\GITHUB-SETUP.md`
   says how to change it). **Watch** on its page is set to All activity, so GitHub notifies you of every new
   report. Left for you: it is public under your account name, so look it over, and add the flightsim.to link to
   its readme once the listing exists.
3. **Publish the source?** Done: the source is public in the same repository
   (https://github.com/adhyanmavuri-tech/auto-step-climb, MIT), so people can build it themselves (`npm install`,
   then `npm run dist`).
4. **Code signing.** Without a certificate, Windows shows "Unknown publisher" (RoutePilot's installer does the
   same). The text above says so.
5. **Category.** Pick the closest utility category on the form.
6. **A real flight.** The A330 profile now ships marked `"verified": true`, on your word. Before announcing it,
   fly one real flight with the installed app and Live control on (Confirm each step on for the first step, to
   watch the FMA).
7. **The old copy.** The overnight command-line copy of this program (the one on port 8787) is closed (the PC
   restarted). Keep it that way: two copies would both read the sim, and both could operate the FCU.
8. **The new mode in a real aircraft.** Before announcing it, fly one flight in one of the named aircraft (the A350,
   A340 or 777 are the ones that climb by themselves) with BeyondATC running and **Ask BeyondATC for the steps in
   other aircraft** switched on, and see the first real BeyondATC answer. The aircraft list on this page comes from
   `docs\AIRCRAFT-RESEARCH.md`: only the A340, A350 and 777 are confirmed to have an automatic step climb, and the
   app works the same for every aircraft either way.
