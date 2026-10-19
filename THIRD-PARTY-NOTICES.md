# Third-party notices

Auto Step Climb is MIT licensed (see `LICENSE`). It includes the following.

## Electron and Chromium

The app runs on [Electron](https://www.electronjs.org/) (MIT). Electron includes Chromium and other software
under their own licences. The full texts are in the installed app's folder: `LICENSE.electron.txt` and
`LICENSES.chromium.html`.

## node-simconnect

The connection to Microsoft Flight Simulator uses
[node-simconnect](https://github.com/EvenAR/node-simconnect) by Even Arneberg Rognlien, licensed under the
**GNU Lesser General Public License v3.0 or later** (LGPL-3.0-or-later).

It is used unmodified, as a separate module, not merged into the app's own code. In the installed app it is the
folder `resources\app.asar.unpacked\node_modules\node-simconnect`, next to its own `LICENSE`. You can replace
that folder with another version of the library, or with your own modified build, and the app will use it. The
library's source is at the address above.

node-simconnect itself uses `debug` (MIT) and `ini` (ISC).

## Airport list

`data/airports.json` is built from [OurAirports](https://ourairports.com/data/) data, which is in the public
domain. It is used to name the airport the aircraft is parked at.

## SimBrief

Flight plans are read from your own SimBrief account through SimBrief's public OFP interface. Auto Step Climb is
not made by or affiliated with SimBrief, Navigraph, Microsoft, Asobo, iniBuilds or BeyondATC.
