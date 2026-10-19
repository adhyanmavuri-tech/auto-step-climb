import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { AircraftGate } from './aircraft-gate.ts'
import type { GateState } from './aircraft-gate.ts'
import { launchDetached, openBrowser, pidFilePath, probe, removePidFile, writePidFile } from './background.ts'
import { loadConfig } from './config.ts'
import { AutoStepCore } from './core.ts'
import { startServer } from './server.ts'
import { startTray } from './tray.ts'

/**
 * The command-line version: the same engine as the Windows app (src/core.ts), shown as a dashboard in the
 * browser on this PC. It is for trying things without the app, for the tests, and for running from source.
 */

const root = path.resolve(import.meta.dirname, '..')
const VERSION = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const { values: args } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    demo: { type: 'boolean', default: false },
    /** Your real flight plan, flown by a simulated aircraft. Never touches the sim (see preview.bat). */
    preview: { type: 'boolean', default: false },
    /** Start a copy with no window and leave it running (see start-background.bat). */
    background: { type: 'boolean', default: false },
    /** With --background: open the dashboard in the browser. */
    open: { type: 'boolean', default: false },
    /** Internal: this copy was started by --background. */
    daemon: { type: 'boolean', default: false },
    /** For this run only: when BeyondATC can't be asked or doesn't clear a step, climb anyway instead of skipping it. */
    'atc-climb-anyway': { type: 'boolean', default: false },
    /** Run with any aircraft. Without it the app closes unless the loaded aircraft is one it supports (the A330). */
    'any-aircraft': { type: 'boolean', default: false },
    port: { type: 'string' },
    config: { type: 'string' }
  }
})

const logDir = process.env.AUTOSTEP_LOG_DIR ?? path.join(root, 'logs')
const logFile = path.join(logDir, 'autostep.log')
const configFile = path.resolve(args.config ?? path.join(root, 'config.json'))

// With no window, a crash would leave no trace, so both go to the log file (through the core, once there is one).
let core: AutoStepCore | null = null
process.on('uncaughtException', (err) => {
  const text = `The app crashed: ${err.stack ?? err.message}`
  if (core) core.log('error', text)
  else console.error(text)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  const text = `Unexpected error: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
  if (core) core.log('error', text)
  else console.error(text)
})

// ---- configuration -----------------------------------------------------------------------

const demo = args.demo === true
const preview = args.preview === true && !demo
/** The aircraft is simulated, so nothing here can reach the real sim. */
const simulated = demo ? 'demo' : preview ? 'preview' : null
const live = args.live === true && !simulated
const { config } = loadConfig(configFile)
// A preview uses the next port up, so it never mixes with a real copy that is running.
if (args.port) config.port = Number(args.port)
else if (preview) config.port += 1

// ---- background: start a copy with no window, then leave -----------------------------------

if (args.background) {
  const url = `http://127.0.0.1:${config.port}`
  if (await probe(config.port)) {
    console.log(`Auto Step Climb is already running: ${url}`)
    if (args.open) openBrowser(url)
    process.exit(0)
  }
  const childArgs = process.argv.slice(2).filter((a) => a !== '--background' && a !== '--open')
  launchDetached(fileURLToPath(import.meta.url), [...childArgs, '--daemon'], root)
  let up = false
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(250)
    up = (await probe(config.port, 500)) !== null
  }
  if (!up) {
    console.error(`It did not start. See ${logFile} for why.`)
    process.exit(1)
  }
  // The copy only stays if the loaded aircraft is one it supports. When a sim is already showing an aircraft
  // the answer comes within seconds, so wait for it and say here if the app is not going to start.
  if (!args['any-aircraft']) {
    let notStarted: string | null = null
    for (let i = 0; i < 36; i++) {
      await sleep(500)
      const st = await probe(config.port, 500)
      if (!st) {
        notStarted = `It closed right after starting. See ${logFile} for why.`
        break
      }
      const gate = st.sim.gate
      if (gate?.verdict === 'ok') break
      if (gate?.reason) {
        notStarted = gate.reason
        break
      }
      if (i >= 5 && !st.sim.connected) break // no sim yet: it waits for one in the background
      if (i >= 15 && !st.sim.title) break // a sim, but no aircraft loaded yet: it waits for one
    }
    if (notStarted) {
      console.error(`Not started: ${notStarted}`)
      process.exit(1)
    }
  }
  const how = args.demo ? 'demo' : args.preview ? 'preview' : args.live ? 'LIVE' : 'watching only'
  const onPort = args.preview || args.port ? ` -- --port=${config.port}` : '' // stop and status look at the configured port unless told
  console.log(`Running in the background (${how}): ${url}\nCheck on it with "npm run status${onPort}", stop it with "npm run stop${onPort}".`)
  if (args.open) openBrowser(url)
  process.exit(0)
}

// ---- the app -----------------------------------------------------------------------------

const app = await AutoStepCore.create({
  host: 'cli',
  version: VERSION,
  simulated,
  live,
  configFile,
  profileDirs: [path.join(root, 'profiles')],
  logDir,
  airportsFile: path.join(root, 'data', 'airports.json'),
  port: config.port,
  persistSettings: false,
  echo: true,
  atcClimbAnyway: args['atc-climb-anyway'] === true,
  demoUnsupported: process.env.AUTOSTEP_DEMO_UNSUPPORTED === '1' // for the tests
})
core = app

// The app only starts if the loaded aircraft is one it supports: it waits while none is loaded, and closes
// with the reason once an unsupported one has stayed loaded (src/aircraft-gate.ts). --any-aircraft skips this.
const gateEnabled = !args['any-aircraft']
const gate = new AircraftGate({ graceMs: Number(process.env.AUTOSTEP_GATE_GRACE_MS ?? 8_000), supported: app.profiles.map((p) => p.name) })
let gateState: GateState = { verdict: 'waiting', title: null, reason: null, short: null }
/** Set once the app has decided to close because the aircraft is not supported. */
let closingReason: string | null = null

app.hooks.onSnapshot = (snap) => {
  if (!gateEnabled) return
  gateState = gate.update(
    Date.now(),
    snap && { title: snap.title, aircraftOk: snap.aircraftOk, hasPosition: !(snap.lat === 0 && snap.lon === 0), matchedProfile: app.adapter.profile?.name ?? null }
  )
  if (gateState.verdict === 'unsupported' && closingReason === null) closeBecause(gateState.reason ?? 'the loaded aircraft is not supported')
}
// `reason` is set once the app has decided to close.
app.hooks.hostState = () => ({ sim: { gate: gateEnabled ? { verdict: gateState.verdict, reason: closingReason } : null } })
app.hooks.closing = () => (closingReason === null ? null : (gateState.short ?? closingReason))
app.hooks.onQuit = () => shutdown()

app.announce()
await app.loadInitialPlan()

const server = await startServer(
  config.port,
  { getState: () => app.getState(), getTray: () => app.getTray(), actions: app.actions },
  path.join(root, 'public')
).catch((err: NodeJS.ErrnoException) => {
  app.log('error', err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use - is another copy running?` : err.message)
  process.exit(1)
})

// Only now that this copy owns the dashboard port does it start talking to the sim, so a second copy
// started by mistake exits without ever touching it.
app.start()

const pidFile = pidFilePath(logDir, config.port)
writePidFile(pidFile, process.pid)
process.on('exit', () => removePidFile(pidFile))

// A copy with no window gets a tray icon, so it can be seen and closed. It is a separate small program
// (src/tray.ts) that only talks to this dashboard, and the app runs the same without it.
if (args.daemon && config.tray && process.env.AUTOSTEP_NO_TRAY !== '1') {
  void startTray({ port: config.port, logDir, root, log: (level, text) => app.log(level, text) }).then((r) => {
    if (!r.ok) app.log('warn', `No tray icon: ${r.reason}. The app works without it`)
  })
}

const banner =
  app.mode === 'live'
    ? 'LIVE: this will operate the A330 FCU when a step point is reached'
    : app.mode === 'demo'
      ? 'DEMO: a simulated aircraft - nothing here touches the simulator'
      : app.mode === 'preview'
        ? 'PREVIEW: your flight plan flown by a simulated aircraft - nothing here touches the simulator'
        : 'DRY RUN: reads the sim and logs what it WOULD do - nothing is sent (start with --live to operate the FCU)'
console.log(`\nAuto Step Climb ${VERSION}\n${banner}\nDashboard: http://127.0.0.1:${config.port}\n`)

function shutdown(code = 0): void {
  app.stop()
  server.close()
  process.exit(code)
}

/** The loaded aircraft is not supported: say why, give a dashboard, the tray and the launcher time to show it, then close. */
function closeBecause(reason: string): void {
  closingReason = reason
  app.log('warn', `Not starting: ${reason}`)
  setTimeout(() => shutdown(3), 4_000)
}
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
