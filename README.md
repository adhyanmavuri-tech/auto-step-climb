# Auto Step Climb for MSFS 2024

A Windows app that flies the step climbs of your SimBrief flight plan in the iniBuilds A330. At each step
point it sets the FCU altitude to the new level and starts the climb (managed or open), the way you would,
so a long cruise can be left alone.

It waits quietly in the system tray and does nothing until the sim is running and your A330 is on the
ground at an airport. Then it fetches your latest SimBrief plan and opens its window behind the sim,
without taking the keyboard from it.

It can also ask **BeyondATC** for the step climbs of other aircraft: the iniBuilds A350, A340, A320neo and
A321LR, the PMDG 777 and 737, the Fenix A320 family, the FlyByWire A32NX and A380X, the Headwind A339X and more.
For those it only asks and tells you the answer: it sends nothing to the aircraft (see *Asking BeyondATC in
other aircraft*).

A step-by-step guide for flyers, with a summary of the tool, is in `docs\USER-GUIDE.md` (it ships in the download
as `USER-GUIDE.txt`).

It is **not** a Community-folder mod. Base-game and payware aircraft have encrypted files, so nothing in
them can be edited. This is a separate Windows program that talks to the sim over SimConnect (with
[node-simconnect](https://github.com/EvenAR/node-simconnect)) and operates the aircraft's own FCU controls.

## Install

Needs Windows 10 or 11 (64-bit), Microsoft Flight Simulator 2024, the iniBuilds A330 (for the automatic climbs;
any other aircraft works for BeyondATC requests) and a (free) SimBrief account. BeyondATC is optional. No
MobiFlight or other add-on is needed.

1. Run `AutoStepClimb-Setup-<version>.exe`. Windows may say "Unknown publisher" because the installer is not
   code-signed: click **More info**, then **Run anyway**. It installs for your user only and needs no
   administrator rights.
2. The first time it opens it asks whether it may **start with Windows**. Say yes: that is how it is already
   waiting in the tray when you load the A330. (You can change this later in Settings.)
3. Open the **Settings** card at the bottom of the window, type your **SimBrief username** and press Save.
4. That is all. There is nothing to start before a flight.

It starts **watching only**: it reads the sim and logs what it would do, but it will **not** climb your aircraft
(the window says so at the top). When you want it to operate the FCU, turn on **Live control** in Settings (see
*Going live*).

To remove it: Windows Settings, Apps, Auto Step Climb, Uninstall. Your settings and logs stay in
`%APPDATA%\Auto Step Climb` until you delete that folder.

## How it behaves

- **It waits.** From the moment it starts it sits in the tray. While the sim is not running, or no flight is
  loaded, or another aircraft is loaded (and asking BeyondATC in other aircraft is off), nothing happens and it
  costs about 55 MB of memory (the figure Task
  Manager shows), no graphics card and well under 1% of one processor core (it runs at below-normal priority, so
  the sim comes first). Windows cannot start a program when something happens inside a sim, so something has to
  be waiting; this is it.
- **It launches at the airport.** When the sim is up and the A330 is on the ground at an airport (moving no
  faster than 60 kt, for about 8 seconds), it fetches your latest SimBrief plan, opens its window, and shows a
  notification naming the airport: `A330 ready at EGLL`. The window opens behind the sim and does not take the
  keyboard from it, so nothing changes under your hands; use the taskbar, Alt+Tab or a second screen to look at
  it. The airport is named from a list that ships with the app. If the plan is for somewhere else the window
  says so ("The aircraft is at EGKK, but the flight plan is EGLL to KJFK. Is it the right flight?"). It
  launches again at the next airport, or after the next flight; not again for the same stay.
- **It picks up a newer plan.** While the aircraft is parked it checks SimBrief once a minute, and switches to
  an OFP generated after the one in use, so you can generate it at the gate. In the air it never swaps the plan
  it is flying, and it never replaces steps you typed in by hand.
- **The window is optional.** The engine flies the steps whether or not the window is open. Closing the window
  (the X) leaves the app running in the tray; the first time it says so. If you started it in flight (after a
  crash, say), it loads the plan by itself as soon as it sees your A330.
- **Turn the pop-up off** with *Open this window at the airport* in Settings. The tray icon still changes.
- **Quit** from the tray icon's menu (or **Quit app** in the window). If a step is in progress, the tray asks
  first, and the window's button refuses until you press **Stop**.

### The tray icon

Look under the **^** arrow next to the clock, and drag the icon onto the taskbar if you want it always
showing. Click it to open the window.

- The dot's colour is the state. **Green**: waiting for the next step. **Cyan**: flying a step. **Amber**: needs
  a look (no sim yet, no supported aircraft, or waiting for you to confirm a step). **Red**: a step failed.
  **Grey**: switched off. Hover for the words: the mode (Live, Watching only) and what it is waiting for, such as
  `32N135W FL380 in 443 NM`.
- Right-click for **Open window**, **Start with Windows**, **Open log folder** and **Quit**.

### Settings

The **Settings** card in the window:

| Setting | What it does |
| --- | --- |
| SimBrief username | Whose latest OFP to fetch |
| Live control | Off: watching only, it will not climb the aircraft. On: the app operates the FCU at each step point. Asks you to confirm when you turn it on |
| Confirm each step | Each step waits for you to press **Confirm step**, and is skipped if you are not there. Leave it off to fly hands-off |
| Open this window at the airport | Whether the window opens by itself at the airport |
| Start with Windows | Whether the app is started when you sign in, so it is waiting for you |

The window's **Fly step downs**, **Ask BeyondATC first** and **Climb anyway if BeyondATC does not clear it**
switches are saved too. Everything else is in
`config.json` (see *All settings*); **Open settings file** opens it.

Where things are: settings and logs in `%APPDATA%\Auto Step Climb` (`config.json`, `logs\autostep.log`), the
program in `%LOCALAPPDATA%\Programs\Auto Step Climb`. The log records everything the app did and why. For a bug
report, press **Copy report** (see *Reporting a problem*).

## Supported aircraft

Everything aircraft-specific lives in a small profile file. The step logic and the SimBrief import are the
same for every aircraft.

| Aircraft | Profile | Status |
| --- | --- | --- |
| iniBuilds / MSFS 2024 A330 (-200, -300) | `profiles\a330.json` (in the install folder) | Included and marked verified, so Live control needs no Control test (the button is still there for a check) |
| Any other aircraft | none needed | **BeyondATC requests only**, when the switch in the window is on: the app reads the aircraft and asks BeyondATC for its steps, and sends nothing to it (see [Asking BeyondATC in other aircraft](#asking-beyondatc-in-other-aircraft)) |
| Flying another aircraft's controls | your own profile | See [Adding an aircraft](#adding-an-aircraft) |

An aircraft with no profile is read but **never controlled**. A profile that isn't marked `verified` can't act
in live mode until it has passed a Control test; the app remembers a pass for that profile, until the profile
file changes.

The app only ever acts for an aircraft it supports. Any other aircraft is ignored ("No supported aircraft
loaded") unless you switch on asking BeyondATC in other aircraft: then it is followed and BeyondATC is asked
about its steps, and nothing is ever sent to it. "Supported" means a profile matches the aircraft's title and the aircraft has the
input events the profile uses, so a third-party A330 without iniBuilds' controls is refused with a "controls
are missing" message in the log.

## How it works

1. You generate an OFP in SimBrief. The app fetches the latest one (or reads a saved file) and finds the steps:
   places where the planned altitude changes once the flight is at cruise (climbs, and step downs if the OFP
   has them). They show up in the **Steps** box in the window in the same `WAYPOINT/FL` form the MCDU's STEP
   ALTS page takes (`ARKIN/370`). If what you typed into the MCDU differs, change the box to match. A
   latitude/longitude waypoint works in either spelling: as the MCDU shows it (`32N35/380`) or as the OFP route
   has it (`32N135W/380`). It is the same step, and after Apply the box shows the route's spelling. The MCDU's
   five-character name is two digits of latitude, a quadrant letter and two digits of longitude: with the letter
   in the middle the longitude is 100-179 (`32N35` is 32N 135W), with the letter last it is 0-99 (`4020N` is 40N
   020W). The letter is N for north/west, E for north/east, S for south/east and W for south/west.
2. While you fly, it places the aircraft on the OFP route from latitude/longitude and counts down to the next
   step point. Position drives it, not time, so time acceleration and pausing don't move a step point (`+NM/FL`
   steps count the distance actually flown).
3. Once you have been level for a minute and you are at the step point, it:
   - sets the FCU altitude to the new level and reads it back, so it never assumes a command worked (turning a
     knob click by click, or setting the altitude in one go, depending on the aircraft);
   - starts the climb: managed (the push action) or open (the pull action, if `climbMode` is `open`);
   - watches for the climb to start, and tries an open climb once if the managed one did nothing;
   - calls the step done when the aircraft levels at the new altitude.
4. If the FCU doesn't respond or no climb starts, it puts the FCU back where it was. If a climb stalls part-way,
   it levels off where it is. It never retries on its own.

Several steps are flown one at a time, in route order. A step that fails or is skipped doesn't stop the ones
after it: the next one starts from where the aircraft really is, as long as that is within `maxStepFt`
(4,000 ft) of its level. `+NM/FL` steps count from the end of the step before them, the first one from
level-off.

A managed climb needs a flight plan in the aircraft's FMS (it climbs along the vertical profile). With none, the
managed command is accepted but nothing climbs, so after 25 seconds the app tries the open climb. If you fly
without a flight plan, set `climbMode` to `open`.

On an aircraft with a 100/1000 ft ring the app learns the step from the first click. If the target isn't a
multiple of it (the ring is on 1000 and the target is FL365, say), it stops with a message and puts the FCU
back instead of hunting back and forth. Set the ring to 100 ft for such a step.

## What it can and cannot see

It reads the aircraft's flight state (position, altitude, vertical speed, Mach, weight, the FCU altitude) and
operates the FCU. It **cannot read the FMS/MCDU**. The A330 has a STEP ALTS page, but the aircraft doesn't
publish that page, the flight plan or the MCDU screen to outside programs: no LVars, no SimConnect data, and the
package is encrypted, so nothing can hook in. The workarounds that exist (OCR of the screen, and a beta add-on
that injects a DLL into the sim) aren't worth the risk. So step points come from your SimBrief OFP, and you
mirror any change you make in the MCDU into the Steps box. It also can't see the aircraft's own
recommended-maximum altitude, so as a safety check it holds a step while the aircraft is heavier than the OFP
planned for that point.

## What you do in the MCDU

The app only operates the FCU (altitude knob, push, pull). The MCDU stays yours. For the managed climb to have
something to follow, set the aircraft up as for any managed flight:

1. **An active flight plan.** The usual route: set your SimBrief ID in the EFB settings, download the OFP on the
   EFB's flight plan page, then press INIT REQ on the MCDU's INIT page. Check the F-PLN page against the OFP,
   because imported plans can lose airways.
2. **INIT B filled in** (ZFW/ZFWCG and block fuel), so the FMS can compute the vertical profile.
3. **CRZ FL** on the INIT page equal to the OFP's first cruise level, and the PERF pages done as usual.
4. **In the cruise**: autopilot on, autothrust active with the thrust levers in the CLB detent, and the FCU on
   the cruise level. That is the state the app expects when it starts a step.

STEP ALTS is optional. The app can't read it, so entering steps there only feeds the aircraft's own predictions;
the steps the app flies are the ones in its Steps box. If you enter them, keep the two the same. If you climb
yourself before the step point, the app sees the new altitude and skips that step instead of fighting you. It
can't see the aircraft's recommended maximum altitude either, so it relies on the OFP's levels and the weight
guard (see Safety). If you are watching, glance at the PROG page first.

## Going live (do this in order)

Live control sends input to the sim, so it is opt-in: it is **off** (the app only watches, and will not climb the
aircraft) until you turn on **Live control** in Settings, and the window asks you to confirm when you do. In the
window: click **Settings** at the bottom, switch **Live control** on and confirm. The A330 profile
(`profiles\a330.json`) is marked verified, so that is all it needs. Then:

1. **First real step**: it steps by itself by default. To watch the first one, turn on **Confirm each step**, so
   it waits at the step point; check the FMA, then press **Confirm step**. Do it in a quiet moment, not in busy
   airspace, and turn it off again afterwards.
2. **Control test** (optional for the A330): with Live control on and the A330 loaded, press **Control test** in
   the window whenever you want to check the FCU on your sim. It changes the FCU altitude by one small step and
   back (the autopilot mode is not touched) and reports whether the FCU followed. A profile that is **not** marked
   verified (one you added yourself) can't act until this test passes; the app remembers the pass for next time.

To see what each control sends, run `npm run listen` from the source folder: it sends nothing.

## Long-haul checklist

The point is to leave it alone: set it up once, check it, then fly or sleep. Nothing needs a click.

1. Generate your OFP in SimBrief and put your username in Settings.
2. Set the aircraft up as in *What you do in the MCDU*: active flight plan, INIT B filled in, CRZ FL set. A
   managed climb needs the flight plan; without it nothing climbs. Load the OFP's fuel and payload too: a step is
   held while the aircraft is more than 3% heavier than the OFP planned for that point.
3. Load the A330 at the airport. When the window opens, check the **Plan** table against your OFP: the steps and
   their levels should match what SimBrief shows. Each climb that hasn't started also shows the weight the OFP
   plans there; if the aircraft's weight (Aircraft card) is more than 3% above it, the step is held.
4. Make sure **Live control** is on. Leave **Confirm each step** off (the
   default) and don't let the PC sleep. The window can be closed; the app keeps flying the steps without it.
   Step downs are off by default: turn on **Fly step downs** if you want the OFP's descents flown too.
5. In cruise it climbs by itself at each step point. If you are watching, the FMA should show CLB (managed) after
   the push; OP CLB means the open fallback ran. At the new level it should go back to ALT CRZ. Note whether the
   MCDU's CRZ FL followed the new level: on iniBuilds' A340 it does by itself, and the A330 is expected to do the
   same, but that is unconfirmed. If it didn't, enter the new level on the PERF CRZ page. **Stop** ends it at any
   time.
6. Afterwards, the Plan table shows what was done, skipped or failed, and `logs\autostep.log` records everything
   the app did and why. Send it with any bug report.

While you are away, anything unexpected makes it do less, never more. It skips a step it couldn't start within
`lateWindowNm` of the fix, pauses when you are off the route, holds a step while the aircraft is heavier than the
OFP planned, puts the FCU back if it didn't respond, and levels off if a climb stalls. It never retries on its
own.

## Asking BeyondATC for the step

BeyondATC only changes your cleared level when you ask for a new one, and users report that it doesn't recognise
a step climb you make without asking. Turn on **Ask BeyondATC first** (the switch in the window, or
`engine.atcFirst` in `config.json`) and the app asks for you:

1. About 10 NM before the step point it chooses *Request Altitude Change* in BeyondATC and then the new level
   from its menu, the way you would. Nothing is typed into a terminal. On the radio it goes like this (seen
   live): your pilot says "request altitude change"; the controller answers "I didn't get that altitude, say
   again altitude" (that is normal, not a fault); about ten seconds after the request a menu of levels appears in
   BeyondATC (`Cancel Altitude Change`, `FL340`, `FL360`, `FL380`, ..., `Say Again`); the app chooses the level
   and your pilot says "Request FL380". If the level is never chosen, the controller keeps asking "say again
   altitude" until the request is cancelled (on the first real flight that went on for hours), so the app
   cancels any request it can't finish.
2. It waits for the controller to say the new cruise altitude. Only then does it set the FCU and climb.
3. If ATC refuses or doesn't answer, it asks once more after two minutes, then skips the step. It never climbs
   without a clearance. If BeyondATC isn't running, the step waits and is skipped.

   The switch **Climb anyway if BeyondATC does not clear it** (under *Ask BeyondATC first*, off by default,
   `engine.atcClimbAnyway`) changes that for a flight on your own: when BeyondATC can't be asked, or still hasn't
   cleared the step after the second try, the step is climbed anyway instead of skipped. Turning it on asks you
   to confirm. Leave it off on VATSIM or IVAO.

Turn on **Auto Respond** in BeyondATC so its copilot reads the clearance back; the app doesn't do that. Auto Tune
keeps the radio on the right frequency. Together that covers a flight left running overnight, except "report
ready for descent" on the way in, which is still yours to do.

BeyondATC has no official interface for other programs. Its toolbar uses a local connection
(`ws://127.0.0.1:41716`) that community tools also use, and this follows the same messages. The app talks to it
with its own small WebSocket client (`src/ws-client.ts`) rather than Node's built-in one: BeyondATC compresses
its messages whenever a client offers compression, and Node's then hands over blanks, which is why the first real
flight's requests got no answer. The app only connects while the mode is on, and only to this PC. A BeyondATC
update can change those messages; then the app can't ask, and the step waits and is skipped, which is all that
happens. A manual **Step now** never asks ATC. (For developers: `npm run atc-listen` prints what BeyondATC sends
without sending anything, and `npm run atc-probe -- --yes` checks the whole exchange without changing your
altitude: your pilot makes two calls on the radio, so run it in cruise with a controller tuned.)

## Asking BeyondATC in other aircraft

Some aircraft climb to the next level by themselves at the step point (the iniBuilds A340 and A350 and the PMDG
777 have an automatic step climb option, for example), and with the rest you climb yourself. Either way
BeyondATC only changes your cleared level when you ask for a new one, so a climb that nobody asked for goes
unnoticed. Turn on **Ask BeyondATC for the steps in other aircraft** (the switch in the window under *Steps*, or
`engine.atcOtherAircraft` in `config.json`) and the app asks for you.

It works with any aircraft. It only reads the aircraft's position and altitude, so it needs no profile and no
add-on (not MobiFlight either). It is aimed at the iniBuilds A350, A340, A320neo and A321LR, the PMDG 777 and 737
families, the Fenix A319/A320/A321, the FlyByWire A32NX and A380X and the Headwind A339X. It has been tried against
a simulated aircraft and a pretend BeyondATC, not flown in each of them: treat the first flight as a test.

1. Load the aircraft and generate your SimBrief plan as usual. The window opens at the airport as it does for the
   A330, and says **Asking BeyondATC** at the top.
2. About 10 NM before each step point (`engine.atcOtherLeadNm`; about 75 seconds at cruise speed), in stable
   cruise, it asks BeyondATC for the new level the way it does for the A330 (see above) and waits for the
   controller's answer. If ATC refuses or says nothing it asks once more after two minutes.
3. It tells you what ATC said, as a line in the log and a Windows notification: "BeyondATC cleared FL380" or
   "BeyondATC did not clear FL380". Then the aircraft climbs by itself, or you climb it. Once the aircraft is at
   the level the step shows as done.

It never sends anything to the aircraft: there is no profile, so there is no control to send. It cannot stop an
automatic step climb either, so if BeyondATC says no and the aircraft is about to climb by itself, switch its
automatic step climb off yourself (the iniBuilds A340 guide recommends that online anyway). An automatic step
climb may also start before BeyondATC has answered: asking takes up to two minutes and 10 NM is about 75 seconds
at cruise speed. The answer still shows when it arrives; to ask earlier, raise `engine.atcOtherLeadNm`. It needs
BeyondATC running on this PC. It works with Live control on or off: Live control is about the
FCU, which this mode never touches. Everything else above about BeyondATC applies (Auto Respond, Auto Tune, the
unofficial connection).

## Adding an aircraft

Every aircraft exposes its autopilot differently, so each one needs a profile to be flown by the app. Adding one takes one short
session in the sim. A profile is a JSON file; the app reads every `*.json` in the `profiles` folder of its install
folder and in `%APPDATA%\Auto Step Climb\profiles` (put your own there, so an update never overwrites them).
Files starting with `_` are ignored (the templates and drafts).

**1. Draft it.** From the source folder, with the aircraft loaded:

```
npm run discover -- --write-profile
```

It lists the FCU-related input events and the current autopilot SimVars. If it finds a knob-style set (an ALT
rotary plus push and pull events, as on the iniBuilds aircraft) it writes `profiles/_draft-<aircraft>.json`. If
not, the aircraft probably uses key events, LVars or H-events; use the direct template in step 3.

**2. Confirm it.** Every value in a draft is a guess. Three ways to check:

- Run `npm run listen` and operate the knob. The SimVar lines show what each click does to the FCU window
  (`fcuSelectedFt`, often `AUTOPILOT ALTITUDE LOCK VAR` or its `:3` variant) and how far it moves. It can't see
  input-event changes made by the mouse, so don't expect INPUT lines.
- Read the aircraft's own code. In Developer Mode open **Tools, then Behaviors**, hover a cockpit control and
  press **Ctrl+G**. The Inspector shows which events the control writes and with what values.
- Run `npm run impulse -- <EVENT> 1 --yes` (it sends input, so do it on the ground). It sends one value and shows
  whether the aircraft consumes it like a click, meaning the value returns to 0 by itself. A value that stays set
  is put back to 0.

Then fix the file, rename it to `<aircraft>.json` (drop the `_draft-`), restart the app, and press **Control
test** with Live control on. The test only moves the FCU by one click and back.

**3. Direct style.** For aircraft where one SimConnect key event sets the altitude (for example
`AP_ALT_VAR_SET_ENGLISH`, which takes feet), start from `profiles/_template-direct.json`. The app can't list key
events for you; take the names from the aircraft's own documentation or community lists. A wrong name does
nothing, and the Control test shows it.

| Field | Meaning |
| --- | --- |
| `name` | Shown in the window |
| `titlePattern` | Regular expression matched (ignoring case) against the aircraft title. The longest matching pattern wins |
| `verified` | `true` once you've confirmed it works. `false` makes live mode require a passing Control test |
| `control` | `knob`: altitude is turned click by click. `direct`: altitude is set in one action |
| `simVars.fcuSelectedFt` | What the FCU altitude window shows (a SimVar, or an `L:` variable) |
| `simVars.apTargetFt` | What the autopilot is flying to |
| `knob` | `knob` style only: `inputEvent`, `upValue`, `downValue` for the ALT rotary |
| `setAltitude` | `direct` style only: an action that sets the altitude (use `"altitudeFt"` as the value) |
| `engage.managed` | Actions that start a managed climb (usually push). At least one |
| `engage.open` | Actions that start an open climb (usually pull). Optional |

An **action** is `{ "inputEvent": "NAME", "value": 1, "releaseValue": 0, "pulseMs": 200 }` (set an input event,
optionally release it later) or `{ "keyEvent": "NAME", "data": "altitudeFt" }` (send a SimConnect key event, with
a number or the target altitude as data).

Share a profile by sharing the file. Leave `verified` at `false` unless you tested it on your own sim.

## Safety

- Live control is off until you turn it on, and the window asks you to confirm.
- An aircraft with no profile is never controlled, and an unverified profile can't act until a Control test
  passes. With asking BeyondATC in other aircraft switched on, such an aircraft is read and BeyondATC is asked
  about its steps; nothing is ever sent to the aircraft.
- On VATSIM or IVAO, get your step clearance first. If you are there for every step, turn on **Confirm each
  step**: it waits for your Confirm and skips the step if you don't give it. The iniBuilds A340 guide recommends
  switching automatic steps off in controlled airspace for the same reason.
- It acts only in stable level cruise, only within 30 NM of the planned route, only for steps of up to 4,000 ft,
  and never above `maxAltitudeFt`.
- **Stop** in the window ends whatever is in progress and sends nothing further. It leaves the FCU as it is, so
  check it.
- If the sim stops answering mid-step, the step is abandoned rather than continued blind.
- Opening, hiding or closing the window never changes what the app is doing. The window cannot reach the
  network and can only press the app's own buttons.

## Privacy

Everything runs on your PC. The only thing that leaves it is the request for your latest flight plan, sent to
`simbrief.com` with your SimBrief username: when the A330 reaches an airport, once a minute while it is parked,
when it has no plan and sees your A330, and when you press **Reload OFP**. No account, no telemetry, no update
checks. The connections to the sim and to BeyondATC are to programs on the same PC.

## Reporting a problem

Bug reports and requests go on the project's GitHub issues page,
<https://github.com/adhyanmavuri-tech/auto-step-climb/issues> (an issue form), which is also behind the **Report a
problem** button in Settings.

1. Open the window (click the tray icon) and click **Settings** at the bottom.
2. Press **Copy report**. It puts one block of text on your clipboard: the app and Windows versions, whether Live
   control was on, the aircraft and its profile, your plan and what each step did, what the app was doing, and the
   newest 100 log lines. Your SimBrief name and ID, your Windows user name and the folders under it are blanked
   out. The tray icon's menu has the same item.
3. Paste it into the bug report form, and say what you expected and what happened.

The app never sends the report itself, so read it before you post it. If the window will not open, the log is
`%APPDATA%\Auto Step Climb\logs\autostep.log` (**Open log folder** in the tray menu): attach that instead.

## All settings

`config.json` in `%APPDATA%\Auto Step Climb` (**Open settings file** in the window). The window writes the
settings it shows back to this file without disturbing the rest, so you can edit it by hand too. Changes by hand
apply the next time the app starts. Everything under `engine` is optional.

| Setting | Default | Meaning |
| --- | --- | --- |
| `simbrief.username` / `simbrief.userId` | empty | Whose latest OFP to fetch (a user ID wins over a username; saving a username in the window clears the ID) |
| `planFile` | empty | A saved OFP (JSON) to use instead of fetching (a path relative to this file's folder, or full) |
| `manualSteps` | `[]` | No OFP? `[{ "afterNm": 300, "toFl": 360 }]` climbs after 300 NM of level cruise; each later entry counts from the end of the step before it |
| `stepAt` | `previous-fix` | `previous-fix`: start at the fix before the first one showing the higher altitude, which is where SimBrief's own step list puts the step. `fix`: start at that first fix, one fix later |
| `live` | `false` | Live control on (the Settings switch writes this) |
| `openWindowAtAirport` | `true` | Open the window when the A330 reaches an airport |
| `engine.climbMode` | `managed` | `managed` uses the profile's managed action (push), `open` the open one (pull) |
| `engine.fallbackToOpen` | `true` | If the managed climb starts nothing, try the open one once |
| `engine.confirmEachStep` | `false` | `false`: climbs by itself. `true`: waits for you to press Confirm at each step point, and skips the step if nobody does by `lateWindowNm` past the fix |
| `engine.leadNm` | `0` | Start this many NM before the step fix |
| `engine.lateWindowNm` | `40` | Still start up to this far after the fix, then skip the step |
| `engine.maxCrossTrackNm` | `30` | Pause when this far off the planned route |
| `engine.weightGuard` | `true` | Hold a step while heavier than the OFP planned |
| `engine.weightToleranceFrac` | `0.03` | How much heavier counts as too heavy (3%) |
| `engine.minCruiseAltFt` | `20000` | The lowest altitude that counts as cruise. Lower it only to test a step low down, never for real flying |
| `engine.maxAltitudeFt` | `41000` | Never step above this |
| `engine.maxStepFt` | `4000` | Skip steps bigger than this |
| `engine.atcFirst` | `false` | Ask BeyondATC for each step and climb only once ATC clears it (the window has a switch) |
| `engine.atcClimbAnyway` | `false` | With `atcFirst` on: climb anyway when BeyondATC can't be asked or still hasn't cleared the step after the second try, instead of skipping it (the window has a switch) |
| `engine.atcLeadNm` | `10` | Ask this many NM before the step fix |
| `engine.atcOtherAircraft` | `false` | Follow any aircraft the app does not control and ask BeyondATC for its steps; nothing is sent to the aircraft (the window has a switch) |
| `engine.atcOtherLeadNm` | `10` | For such an aircraft: ask this many NM before the step fix. An aircraft with an automatic step climb may start it at the step point, so a longer lead gives the answer more time to arrive first |
| `engine.atcTimeoutMs` | `120000` | Give up waiting for an answer after this long |
| `engine.atcRetryMs` | `120000` | After a refusal or silence, ask once more after this long |
| `atc.port` | `41716` | Where BeyondATC's toolbar connection is (this PC only) |
| `engine.stepDowns` | `false` | Also fly the OFP's step descents. Off: the aircraft stays at the higher level and the later climbs back up are skipped (the window has a switch) |
| `engine.levelOffOnStall` | `true` | Level off if the climb stalls below the target |

## If an aircraft update breaks it

If an update renames an input event the profile uses, the app says which one is missing and refuses to act. Run
`npm run discover` from the source folder, find the new name, and edit the profile. No code change is needed.

## Known limits

- The step logic and the SimConnect connection were flown live on a real overnight flight from San Francisco to
  Nadi (KSFO to NFFN), with the command-line version and the iniBuilds A330: the managed push worked on the first
  step, and the second step needed the open pull. The
  Windows app's window, tray, launch and installer are checked against a simulated aircraft and a simulated
  parked A330 only, so treat the first live run with the Windows app as a test, and keep **Confirm each step**
  on for it.
- Time acceleration and pausing are handled from the aircraft's position, and so far only against a simulated
  aircraft, not in the real sim. A pause in the middle of a step is not handled: the step's timeouts keep
  running, so it can be abandoned (the FCU is put back) and the step is lost.
- It talks to BeyondATC only (see *Asking BeyondATC for the step*), through an unofficial interface. It can't
  request or announce a step climb to a controller on VATSIM or IVAO, and a step in the filed route isn't a
  clearance either. There, use **Confirm each step**: it stops at the step point and waits for you to get the
  clearance and press Confirm. BeyondATC's Auto Respond only reads back what ATC tells you, so it doesn't ask for
  steps by itself.
- Steps typed into the MCDU can't be read (see above). Type the same lines into the Steps box. If Microsoft or
  an aircraft maker ever publishes MCDU data, only the step source needs to change.
- Only the iniBuilds A330 profile ships. It is marked verified from the author's own flights (see the
  first point above); it has not been checked on other setups. Other aircraft, especially ones that use LVars or
  H-events rather than input events or key events (some need a WASM module), may not be reachable at all.
- The step point comes from the OFP navlog. SimBrief shows the new level at the fix after the step point, so the
  app starts the climb at the fix before the first one that shows the higher level. On a real long-haul OFP that
  matches SimBrief's own step list (`general.stepclimb_string`) for every step. Compare the Plan table against
  your OFP once; `stepAt: "fix"` starts one fix later.
- Step downs are off by default. While they are off, an OFP that steps down for airspace level rules leaves the
  aircraft at the higher level, and the later climbs back up show as skipped ("already at or above"). When they
  are on, a descent uses the same push or pull as a climb, which has not been checked on the A330 yet. Levels in
  metres, as used in China, appear as odd levels such as FL401 (12,200 m).
- The installer is not code-signed, so Windows SmartScreen shows an "Unknown publisher" warning.

## For developers

The app is Electron (the same kind of installer as RoutePilot). The engine is plain TypeScript that Node runs
directly, so tests need no build step.

```
npm install                 once (needs the network: Electron and the build tools)
npm test                    offline tests: planning, route tracking, profiles, the whole step sequence against
                            a simulated aircraft (including failures), the launch trigger, settings, the window's
                            addresses, the icons, and the command-line version end to end
npm run typecheck           the engine, scripts and tests
npm run typecheck:electron  the Electron part too (needs electron installed for its types)
npm run app -- --preview    run the app from source on a simulated aircraft flying your plan (--demo: a made-up
                            route). Never touches the sim. Without a flag it is the real thing and waits for the sim
npm run dist                build release\AutoStepClimb-Setup-<version>.exe and the flightsim.to zip
```

- `src/core.ts` is everything that makes it work with nothing about how it is shown: the engine, the sim, the
  plan, the ATC link, the log and the settings. `src/main.ts` (the command-line version) and `electron/main.ts`
  (the Windows app) are two ways to show it. `src/engine.ts` is the decision logic: latest reading in, commands
  out, which is why the tests can drive it with a fake aircraft. `src/profile.ts` and `src/actions.ts` turn a
  profile and a command into the exact sends. `src/sim.ts` is the only file that talks to the real simulator.
- `src/launch-trigger.ts` decides when the app "launches" at an airport; `src/airports.ts` names the airport from
  `data\airports.json` (built from the public-domain [OurAirports](https://ourairports.com/data/) data by
  `npm run build-airports -- --src=airports.csv`).
- `electron/` holds the window, the tray, the page's private `autostep://app` address and the icons, which are
  drawn in code (`npm run build-icons`). The window's page is `public/`.
- `src/report.ts` builds the text behind **Copy report** (and blanks out the person); `src/support.ts` holds the
  address of the bug report page (`ISSUES_URL`; empty means no **Report a problem** button). This folder is
  itself the repository behind that page (the issue forms are in `.github/ISSUE_TEMPLATE`) and
  `docs\GITHUB-SETUP.md` says how to change them.
- `npm run dist` bundles with esbuild and packages with electron-builder. If those are already installed in
  another project, set `AUTOSTEP_TOOLS_DIR` to that project's folder and nothing is installed or downloaded
  (the build blocks any download unless you set `AUTOSTEP_ALLOW_DOWNLOADS=1`).
- The self-test: `"Auto Step Climb.exe" --preview --selftest=FOLDER --user-data=FOLDER2` runs the app on a
  simulated aircraft with its window drawn into memory, checks that it all works from the inside, and writes
  `report.json` and pictures of the window. It never touches the sim.
- `build\installer.nsh` works around a crash in the installer tool's own start-up code (a 16 KB read from a small
  block of memory, which crashed the installer on about 7 starts in 10 on Windows 11 25H2); see the comment in
  that file before changing it.

### The command-line version

The same engine without the window: a dashboard in your browser at <http://127.0.0.1:8787>. It is for trying
things, for the tests, and for running from source. It only **watches** (it will not climb the aircraft) unless
started with `--live` every time (a `live` setting in `config.json` is ignored there on purpose).

```
start.bat / start-live.bat                  run in a console (npm start, npm start -- --live)
start-background.bat / start-live-background.bat   no window; status.bat, stop.bat (npm run background/status/stop)
npm run demo                                a simulated aircraft on a made-up plan, sped up
preview.bat (npm run preview)               your flight plan flown by a simulated aircraft, on port 8788
```

- It closes at once, with the reason, when the loaded aircraft is not one it supports (`--any-aircraft` skips
  that check). A second copy refuses to start while one is running.
- It has its own small tray icon program (`tray\AutoStepClimbTray.cs`, built once into `bin\` with the C# compiler
  that comes with Windows; `"tray": false` turns it off) and its settings live in `config.json` in the project
  folder (copy `config.example.json`).
- `--atc-climb-anyway` (one run only, never saved, and only while **Ask BeyondATC first** is on): when BeyondATC
  can't be reached, or still hasn't cleared the step after the second try, the step is climbed anyway instead of
  skipped. Use it only when nobody is there and no human controller is involved.
- Don't run it at the same time as the Windows app: both would read the sim, and both would operate the FCU.

## Licence and credits

MIT, see `LICENSE`. Other software in the app, including Electron and the LGPL-licensed node-simconnect, is
listed in `THIRD-PARTY-NOTICES.md`. Airport names: [OurAirports](https://ourairports.com/data/) (public
domain). Flight plans: [SimBrief](https://www.simbrief.com/). Not made by or affiliated with SimBrief, Microsoft,
Asobo, iniBuilds or BeyondATC.
