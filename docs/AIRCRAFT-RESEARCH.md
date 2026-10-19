# Which MSFS 2024 aircraft climb by themselves? (research, 2026-10-18)

Question: which airliners people use in Microsoft Flight Simulator 2024 have an automatic step climb, so that
Auto Step Climb's BeyondATC requests are most useful for them? Method: web searches and the developers' own
forums and release notes. Where a claim comes from a forum post and not from a manual, it says so.

## How many people fly what

The only usage figures found for MSFS are in Navigraph's FlightSim Community Survey 2026 (published 2026-04-21,
more than 42,000 respondents; self-reported, so not necessarily representative):

| Aircraft family | Share of respondents |
| --- | --- |
| Fenix Airbus A319/A320/A321 | 43% (42.4% in another summary) |
| PMDG 737 variants | 32% (31.5%) |
| PMDG 777 | 23% (23.3%), the most used widebody |
| iniBuilds A350 | 15.7%, the second most used widebody |

The survey named the iniBuilds A350 the best release of the past year. No 2026 figures were found for the other
aircraft below, so they are not ranked by number.

## The ten most used airliners, and whether each climbs by itself

| # | Aircraft | Automatic step climb? | Evidence |
| --- | --- | --- | --- |
| 1 | Fenix A319/A320/A321 | No evidence of one | The FMGC takes step altitudes and predicts the point (Fenix forum posts); the crew climbs |
| 2 | PMDG 737-600/700/800/900 | Not confirmed | A guide for PMDG Boeings in MSFS has the crew set the MCP altitude and VNAV climb at the step point; no "auto step" option found for the 737 |
| 3 | PMDG 777 | **Yes** | PMDG's own forum (777 for MSFS) has threads on its "Auto Step Climb" option, switched on in the tablet, with a step size set; a moderator says it works from the FMC's prediction and is meant for time compression |
| 4 | iniBuilds A350-900/-1000 | **Yes** | Update 1.0.8: "Auto step-climb function is now available", with SimBrief import of step climbs; iniBuilds forum threads discuss its auto step climb logic |
| 5 | iniBuilds A340-300/-600 (MSFS 2024) | **Yes** | iniBuilds' guide: switch on AUTO STEP CLIMB in EFB Settings, Aircraft Settings; steps come from the STEP ALTS page or from SimBrief; the guide advises turning it off in controlled airspace online; the product page lists it |
| 6 | FlyByWire A32NX | No evidence of one | Managed climbs are started from the FCU (set the altitude, push the knob) |
| 7 | FlyByWire A380X | No evidence of one | v0.14 notes mention only the step climb maximum level |
| 8 | iniBuilds A330 (the MSFS 2024 base aircraft) | No | This is the aircraft Auto Step Climb flies itself |
| 9 | iniBuilds A310 / A300-600R | No (A310 reported to stay in altitude hold at the step point) | iniBuilds forum, 2022 thread for the A310; nothing found for the A300 |
| 10 | Working Title 787-10 and 747-8 (base game), Salty 747, Headwind A339X, iFly 737 MAX 8 | Unknown | Nothing found either way |

So three aircraft families are confirmed: the **PMDG 777**, the **iniBuilds A350** and the **iniBuilds A340**.
The PMDG 737 is the one to check next. Nothing here is from a manual: confirm in the aircraft before relying on a row.

## What that means for Auto Step Climb

BeyondATC only changes your cleared level when you ask, and an aircraft's own automatic step climb does not ask.
The new "ask BeyondATC for the steps in other aircraft" mode asks for you before each step point and tells you
the answer. It works with any aircraft, because it only reads the aircraft's position and altitude and sends
nothing to it. It matters most for the three above (they climb on their own), and it also helps with the others,
where you climb yourself once BeyondATC has cleared the level.

## Sources

- Navigraph survey: https://navigraph.com/blog/survey-2026 and https://fselite.net/content/2026-navigraph-survey-decoded-msfs-xplane12/
- iniBuilds A340 step climbs guide: https://forum.inibuilds.com/topic/33773-how-to-step-climbs-automanual-setup-operation
- iniBuilds A340 product page: https://inibuilds.com/products/inibuilds-a340-airliner-msfs-2024
- iniBuilds A350 1.0.8: https://fsnews.eu/inibuilds-updates-a350-to-version-1-0-8/
- iniBuilds A350 auto step climb threads: https://forum.inibuilds.com/topic/34870-auto-step-climb-logic-issues and https://forum.inibuilds.com/topic/35190-step-climb-auto-step-climb-logic-in-a350-questions
- PMDG 777 (MSFS) forum: https://forum.pmdg.com/forum/microsoft-flight-simulator-2020-2024-products-discussion/pmdg-777/autoflight-manual-flight-navigation-aa/310979-auto-step-climb
- PMDG step climbs in MSFS (guide): https://flyawaysimulation.com/ask/answers/pmdg-step-climbs-msfs/
- FlyByWire A380X v0.14 notes: https://docs.flybywiresim.com/release-notes/a380x/v0140/
- FlyByWire A32NX VNAV guide: https://flyawaysimulation.com/ask/answers/use-vnav-flybywire-a32nx-msfs/
- iniBuilds A310 step climb thread: https://forum.inibuilds.com/topic/7019-a310-for-msfs-step-climb
- Fenix step altitudes (forum): https://forums.flightsimulator.com/t/a320-tips-tricks/231163?page=6
