import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, protocol, screen, session, shell, Tray } from 'electron'
import type { IpcMainInvokeEvent, NativeImage, Rectangle } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { saveConfigValues } from '../src/config-write.ts'
import { AutoStepCore } from '../src/core.ts'
import type { ActionFn, HostState } from '../src/core.ts'
import { LaunchTrigger } from '../src/launch-trigger.ts'
import type { LaunchState } from '../src/launch-trigger.ts'
import { loadProfiles } from '../src/profile.ts'
import { issuesUrl } from '../src/support.ts'
import type { Snapshot } from '../src/types.ts'
import { APP_ORIGIN, CONTENT_SECURITY_POLICY, resolveAsset } from './assets.ts'
import { APP_ICON_PNG, TRAY_ICONS } from './icons.generated.ts'
import type { TrayLevel } from './icons.generated.ts'

/**
 * The Windows app. It waits in the tray from the moment it starts (usually with Windows), and does nothing but
 * watch for the sim. When the sim is up and the A330 is on the ground at an airport it fetches the day's flight
 * plan and opens its window, behind the sim and without taking the keyboard from it. From then on the engine
 * (src/core.ts) looks after the step climbs whether or not the window is open: closing the window only closes
 * the window, and the app keeps working from the tray until it is quit from there.
 */

const APP_NAME = 'Auto Step Climb'
const APP_ID = 'com.adhyanmavuri.autostepclimb'
/** How often to look for a flight plan that is missing, or (while parked) for a newer one. */
const PLAN_CHECK_MS = 60_000

// ---- how it was started --------------------------------------------------------------------------------------
// The installed app is started with no options, or with --background by Windows. The others are for checking it:
// a simulated aircraft that never touches the sim, a folder of its own for settings, and a self-test that exits.

interface Flags {
  /** Start with no window (what the Windows start-up entry does). */
  background: boolean
  demo: boolean
  preview: boolean
  /** With --demo or --preview: the simulated aircraft is one the app does not control, to show asking BeyondATC for its steps. */
  otherAircraft: boolean
  /** Run the self-test, write its report and pictures into this folder, and exit. */
  selftest: string | null
  /** Keep settings and logs in this folder instead of the usual one. */
  userData: string | null
}

function readFlags(argv: string[]): Flags {
  const value = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : null
  }
  return {
    background: argv.includes('--background'),
    demo: argv.includes('--demo'),
    preview: argv.includes('--preview'),
    otherAircraft: argv.includes('--other-aircraft'),
    selftest: value('selftest'),
    userData: value('user-data')
  }
}

const flags = readFlags(process.argv.slice(1))
const simulated = flags.demo ? 'demo' : flags.preview ? 'preview' : null

// ---- set-up that has to happen before the app is ready ----------------------------------------------------------

app.setName(APP_NAME)
app.setPath('userData', flags.userData ? path.resolve(flags.userData) : path.join(app.getPath('appData'), APP_NAME))
app.setAppUserModelId(APP_ID)
// A companion to a sim should not ask the graphics card for anything: the window is a few cards of text, drawn
// by the processor. (Measured: running the graphics helper inside the main process instead uses more memory
// in total, not less, so it stays a separate process. Waiting in the tray the app takes about 110 MB.)
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'autostep', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const userDataDir = app.getPath('userData')
const logDir = path.join(userDataDir, 'logs')
const configFile = path.join(userDataDir, 'config.json')
const appRoot = app.getAppPath()
const publicDir = path.join(appRoot, 'public')
const builtinProfiles = app.isPackaged ? path.join(process.resourcesPath, 'profiles') : path.join(appRoot, 'profiles')

// ---- state ------------------------------------------------------------------------------------------------

let core: AutoStepCore
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let trayHintShown = false
let startWithWindows = false
let launch: LaunchState = { phase: 'no-sim', place: null }
let lastPlanCheck = 0
let trayKey = ''
const timers: NodeJS.Timeout[] = []
const trayImages = new Map<TrayLevel, NativeImage>()

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const logLine = (level: 'info' | 'warn' | 'error', text: string): void => (core ? core.log(level, text) : crashLog(`${level.toUpperCase()} ${text}`))

/** For what happens before the core exists, and for what it cannot say itself. */
function crashLog(text: string): void {
  try {
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(path.join(logDir, 'crash.log'), `${new Date().toISOString()} ${text}\n`)
  } catch {
    // nowhere left to say it
  }
}

// A hands-off app must not stop on an error, and must not put up the error box Electron shows by default.
process.on('uncaughtException', (err) => logLine('error', `Unexpected error: ${err.stack ?? err.message}`))
process.on('unhandledRejection', (reason) => logLine('error', `Unexpected error: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`))

// ---- the start-up entry --------------------------------------------------------------------------------------

/** The same arguments are used to set the entry and to read it back, because Windows compares them. */
const LOGIN_ARGS = ['--background']

function readLoginItem(): boolean {
  try {
    return app.isPackaged && app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin
  } catch {
    return false
  }
}

function setStartWithWindows(on: boolean): string {
  if (!app.isPackaged) throw new Error('Start with Windows only works in the installed app')
  app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS })
  startWithWindows = readLoginItem()
  core.log('info', on ? 'Start with Windows: on. The app will wait in the tray after you sign in' : 'Start with Windows: off')
  return on ? 'The app will start with Windows and wait in the tray' : 'The app will no longer start with Windows'
}

// ---- icons -----------------------------------------------------------------------------------------------

const appIconImage = (): NativeImage => nativeImage.createFromBuffer(Buffer.from(APP_ICON_PNG, 'base64'))

function trayImage(level: TrayLevel): NativeImage {
  let image = trayImages.get(level)
  if (!image) {
    image = nativeImage.createEmpty()
    // One picture for each screen scale: Windows takes the one that fits.
    for (const { scale, png } of TRAY_ICONS[level]) image.addRepresentation({ scaleFactor: scale, buffer: Buffer.from(png, 'base64') })
    trayImages.set(level, image)
  }
  return image
}

// ---- the window --------------------------------------------------------------------------------------------

const boundsFile = (): string => path.join(userDataDir, 'window.json')

/** Where the window was last, when that place is still on a screen. */
function loadBounds(): Rectangle | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))
    if (!isRecord(raw)) return null
    const { x, y, width, height } = raw
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null
    if (!(width >= 420 && height >= 520)) return null
    const onScreen = screen.getAllDisplays().some((d) => x + 100 >= d.workArea.x && x + 100 < d.workArea.x + d.workArea.width && y + 20 >= d.workArea.y && y + 20 < d.workArea.y + d.workArea.height)
    return onScreen ? { x, y, width, height } : null
  } catch {
    return null
  }
}

function saveBounds(bounds: Rectangle): void {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(bounds))
  } catch {
    // the window just opens in the default place next time
  }
}

interface WindowOptions {
  /** No window at all on the screen: the page is drawn into memory (for the self-test). */
  offscreen?: boolean
  width?: number
  height?: number
}

function createWindow(options: WindowOptions = {}): BrowserWindow {
  const saved = options.offscreen ? null : loadBounds()
  // The self-test opens its windows where nobody can see them: it must not put anything on the screen.
  const parked = flags.selftest && !options.offscreen ? { x: -32000, y: -32000 } : null
  const w = new BrowserWindow({
    width: options.width ?? saved?.width ?? 1100,
    height: options.height ?? saved?.height ?? 820,
    ...(parked ?? (saved ? { x: saved.x, y: saved.y } : {})),
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    icon: appIconImage(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#11151b' : '#f4f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      ...(options.offscreen ? { offscreen: true } : {})
    }
  })
  w.removeMenu()
  // The page is the app's own and has nowhere else to go.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault()
  })
  if (!options.offscreen) {
    w.on('close', () => saveBounds(w.getNormalBounds()))
    w.on('closed', () => {
      if (win === w) win = null
      if (!quitting) hintTray()
    })
  }
  return w
}

/** Opens the window, or brings the open one forward. `inactive` leaves the keyboard where it is (the sim). */
function showWindow(options: { inactive?: boolean } = {}): void {
  const reveal = (w: BrowserWindow): void => {
    if (w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    if (options.inactive) {
      w.showInactive()
    } else {
      w.show()
      w.focus()
    }
    pushState()
  }
  if (win && !win.isDestroyed()) {
    reveal(win)
    return
  }
  const w = createWindow()
  win = w
  w.once('ready-to-show', () => reveal(w))
  void w.loadURL(`${APP_ORIGIN}/index.html`)
}

/** Closing the window leaves the app running, and the first time that happens it says so. */
function hintTray(): void {
  if (trayHintShown) return
  trayHintShown = true
  notify(APP_NAME, 'Still running in the tray, looking after your step climbs. Quit it from the tray icon.')
}

/** What the self-test would have shown as notifications (it shows none: it must not disturb anyone). */
const selftestNotices: { title: string; body: string }[] = []

function notify(title: string, body: string): void {
  if (flags.selftest) {
    selftestNotices.push({ title, body })
    return
  }
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: true, icon: appIconImage() }).show()
  } catch {
    // a notification is a courtesy
  }
}

/** Sends the window the current state. Not while it is hidden or minimised: nobody is looking. */
function pushState(force = false): void {
  const w = win
  if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return
  if (!force && (!w.isVisible() || w.isMinimized())) return
  w.webContents.send('autostep:state', core.getState())
}

// ---- what the window can ask for -------------------------------------------------------------------------

/** The window's page is the only thing that may talk to the app. */
function assertFromWindow(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (!url.startsWith(`${APP_ORIGIN}/`)) throw new Error('Refused: not from the app window')
}

/** The newest report made by "Copy report", kept so the self-test can look at it without touching the clipboard. */
let lastReport = ''

/** The bug report text for this PC: the app's state and log, with the Windows user name and the folders under it blanked out. */
function makeReport(): string {
  let userName = ''
  try {
    userName = os.userInfo().username
  } catch {
    // no user name to hide
  }
  lastReport = core.buildReport({
    os: `${os.version()} (${os.release()}), ${process.arch}`,
    electron: process.versions.electron,
    node: process.versions.node,
    installed: app.isPackaged,
    uptimeSec: Math.round(process.uptime()),
    userName,
    homeDir: os.homedir()
  })
  return lastReport
}

/** The guide that comes with the app: next to the program once installed, in the docs folder when run from the source. */
function guideFile(): string | null {
  const candidates = [path.join(path.dirname(process.execPath), 'USER-GUIDE.txt'), path.join(appRoot, 'docs', 'USER-GUIDE.md')]
  return candidates.find((f) => fs.existsSync(f)) ?? null
}

const hostActions: Record<string, ActionFn> = {
  'set-login-item': (body) => setStartWithWindows(body.enabled === true),
  'copy-report': () => {
    const text = makeReport()
    if (!flags.selftest) clipboard.writeText(text) // the self-test must not touch your clipboard
    return `Report copied (${text.split('\n').length} lines). Paste it into your bug report.`
  },
  'open-issues': async () => {
    const url = issuesUrl()
    if (!url) throw new Error('No bug report page is set up yet')
    if (flags.selftest) return `Would open ${url}` // the self-test must not open your browser
    await shell.openExternal(url)
  },
  'open-logs': async () => {
    fs.mkdirSync(logDir, { recursive: true })
    const problem = await shell.openPath(logDir)
    if (problem) throw new Error(problem)
  },
  'open-config': async () => {
    if (!fs.existsSync(configFile)) saveConfigValues(configFile, [])
    const problem = await shell.openPath(configFile)
    if (problem) throw new Error(problem)
  },
  'open-guide': async () => {
    const file = guideFile()
    if (!file) throw new Error('The guide is not installed with this copy of the app')
    if (flags.selftest) return `Would open ${file}` // the self-test must not open a window on your screen
    const problem = await shell.openPath(file)
    if (problem) throw new Error(problem)
  },
  'show-window': () => showWindow()
}

async function runAction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const fn = Object.hasOwn(hostActions, name) ? hostActions[name] : Object.hasOwn(core.actions, name) ? core.actions[name] : undefined
  if (!fn) throw new Error(`Unknown action: ${name}`)
  return fn(body)
}

function registerIpc(): void {
  ipcMain.handle('autostep:state', (event) => {
    assertFromWindow(event)
    return core.getState()
  })
  ipcMain.handle('autostep:act', async (event, action: unknown, body: unknown) => {
    assertFromWindow(event)
    try {
      const result = await runAction(String(action), isRecord(body) ? body : {})
      pushState()
      return { ok: true, result: result ?? null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// ---- the tray ----------------------------------------------------------------------------------------------

function createTray(): void {
  tray = new Tray(trayImage('off'))
  tray.setToolTip(APP_NAME)
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
  updateTray()
}

/** Refreshes the icon, the hover text and the menu, but only when something about them changed. */
function updateTray(): void {
  if (!tray || tray.isDestroyed()) return
  const t = core.getTray()
  const key = `${t.level}|${t.tip}|${t.line}|${t.title}|${startWithWindows}`
  if (key === trayKey) return
  trayKey = key
  tray.setImage(trayImage(t.level))
  tray.setToolTip(t.tip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t.title, enabled: false },
      { label: t.line, enabled: false },
      { type: 'separator' },
      { label: 'Open window', click: () => showWindow() },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: startWithWindows,
        enabled: app.isPackaged,
        click: (item) => {
          try {
            setStartWithWindows(item.checked)
          } catch (err) {
            core.log('warn', err instanceof Error ? err.message : String(err))
          }
        }
      },
      { label: 'Open log folder', click: () => void hostActions['open-logs']!({}) },
      {
        label: 'Copy report for a bug report',
        click: () => {
          try {
            void Promise.resolve(hostActions['copy-report']!({})).then((message) => notify(APP_NAME, String(message)))
          } catch (err) {
            core.log('warn', err instanceof Error ? err.message : String(err))
          }
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => void quitFromTray() }
    ])
  )
}

async function quitFromTray(): Promise<void> {
  if (core.busy) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: APP_NAME,
      message: 'A step climb is in progress.',
      detail: 'If you quit now, the app stops watching the climb. The FCU is left as it is.',
      buttons: ['Keep running', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (response !== 1) return
  }
  quit()
}

function quit(): void {
  quitting = true
  app.quit()
}

// ---- the launch: the A330 is at an airport ---------------------------------------------------------------------

/** Built again in main() once the airport list is loaded. */
let trigger = new LaunchTrigger()

/** Every reading from the sim comes here first. */
function onSnapshot(snap: Snapshot | null): void {
  const connected = core.adapter.connected
  if (!connected) core.planAttempted = false // a new sim session fetches the plan afresh
  const result = trigger.update(Date.now(), connected, snap)
  launch = result.state
  if (result.fire) void onLaunch(result.state.place)

  // The flight plan: fetched if there is none (the app was started in flight, or the last try failed), and
  // while parked, replaced by a newer one if SimBrief has it, so an OFP generated at the gate is picked up.
  const now = Date.now()
  if (snap?.aircraftOk && now - lastPlanCheck >= PLAN_CHECK_MS) {
    const parked = launch.phase === 'at-airport' || launch.phase === 'launched'
    if (!core.planAttempted || core.planMissing || parked) {
      lastPlanCheck = now
      void core.syncPlan(parked)
    }
  }
}

async function onLaunch(place: LaunchState['place']): Promise<void> {
  const where = place?.icao ? (place.name ? `${place.name} (${place.icao})` : place.icao) : 'an airport'
  const openIt = core.config.openWindowAtAirport
  // The A330 is flown by the app; any other aircraft is only asked about (when that is switched on).
  const asksOnly = core.latest?.control === 'none'
  core.log('info', `The ${asksOnly ? 'aircraft' : 'A330'} is at ${where}: fetching the flight plan${openIt ? ' and opening the window' : ''}`)
  if (openIt) showWindow({ inactive: true })
  lastPlanCheck = Date.now()
  await core.syncPlan(true)
  const state = core.getState() as { plan: { origin: string; destination: string; flight?: string } | null; engine: { steps: unknown[] }; planError: string | null; app: { mode: string } }
  const live = state.app.mode === 'live'
  const route = state.plan ? `${state.plan.origin} to ${state.plan.destination}` : ''
  const what = `${state.plan?.flight ? `${state.plan.flight}, ` : ''}${route}: ${state.engine.steps.length} step climb${state.engine.steps.length === 1 ? '' : 's'}.`
  const body = state.plan
    ? asksOnly
      ? `${what} It asks BeyondATC for each step and tells you the answer. It does not touch your aircraft.`
      : `${what} ${live ? 'Live control is on.' : 'Watching only: it will NOT climb your aircraft. Turn on Live control in Settings to let it.'}`
    : (state.planError ?? 'No flight plan yet.')
  notify(`${asksOnly ? 'Aircraft' : 'A330'} ready at ${place?.icao ?? 'the airport'}`, body)
}

// ---- first run -------------------------------------------------------------------------------------------------

/** The one question the app asks: whether to start with Windows, so it is waiting when the A330 is loaded. */
async function askFirstRun(): Promise<void> {
  if (core.appStateSnapshot.firstRunDone || flags.background || flags.selftest || !app.isPackaged) return
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: APP_NAME,
    message: 'Open Auto Step Climb by itself when your A330 is at an airport?',
    detail:
      'It can start with Windows and wait quietly in the system tray. When your A330 is on the ground at an airport, it fetches your latest SimBrief flight plan and opens its window behind the sim.\n\nYou can change this later in Settings.',
    buttons: ['Start with Windows', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  core.markFirstRunDone()
  if (response === 0) {
    try {
      setStartWithWindows(true)
    } catch (err) {
      core.log('warn', err instanceof Error ? err.message : String(err))
    }
  }
}

// ---- start ---------------------------------------------------------------------------------------------------

function serveAsset(request: Request): Response {
  const asset = resolveAsset(publicDir, request.url)
  if (!asset) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  try {
    return new Response(fs.readFileSync(asset.file), {
      status: 200,
      headers: {
        'content-type': asset.type,
        'content-security-policy': CONTENT_SECURITY_POLICY,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    })
  } catch {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
}

/** Puts the main process and every helper Chromium has started at below-normal priority (none is ever raised). */
function lowerPriorities(): void {
  const below = os.constants.priority.PRIORITY_BELOW_NORMAL
  const pids = new Set<number>([process.pid])
  try {
    for (const m of app.getAppMetrics()) pids.add(m.pid)
  } catch {
    // the metrics are not there yet: the main process is still lowered
  }
  for (const pid of pids) {
    try {
      if (os.getPriority(pid) < below) os.setPriority(pid, below)
    } catch {
      // the process has just gone, or may not be changed: carry on
    }
  }
}

async function main(): Promise<void> {
  // Never in the sim's way: the app takes what is left over. That is the main process and every helper Chromium starts
  // (its graphics helper asks for a higher priority than the app has), kept that way while the app runs.
  lowerPriorities()
  Menu.setApplicationMenu(null)
  protocol.handle('autostep', serveAsset)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  app.on('web-contents-created', (_event, contents) => contents.on('will-attach-webview', (e) => e.preventDefault()))
  app.on('window-all-closed', () => {
    // the app stays in the tray
  })
  app.on('second-instance', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
    for (const t of timers) clearInterval(t)
    core?.stop()
    tray?.destroy()
  })

  fs.mkdirSync(userDataDir, { recursive: true })
  core = await AutoStepCore.create({
    host: 'app',
    version: app.getVersion(),
    simulated,
    live: 'config',
    configFile,
    profileDirs: [builtinProfiles, path.join(userDataDir, 'profiles')],
    logDir,
    stateFile: path.join(userDataDir, 'state.json'),
    airportsFile: path.join(appRoot, 'data', 'airports.json'),
    persistSettings: true,
    echo: false,
    demoOtherAircraft: simulated !== null && flags.otherAircraft
  })
  trigger = new LaunchTrigger({ airports: core.airports })
  core.hooks.hostState = (): HostState => ({ app: { startWithWindows, issuesUrl: issuesUrl() }, launch })
  core.hooks.onSnapshot = onSnapshot
  core.hooks.onQuit = quit
  core.hooks.onNotify = (note) => notify(note.title, note.text)

  registerIpc()
  startWithWindows = readLoginItem()
  core.announce()
  if (simulated) await core.loadInitialPlan()
  core.start()

  createTray()
  timers.push(setInterval(updateTray, 1000))
  timers.push(setInterval(() => pushState(), 1000))
  // Chromium starts helpers later (a window's page, the graphics helper) and can raise a page's process when its window
  // comes to the front: put them back every few seconds.
  timers.push(setInterval(lowerPriorities, 5_000))

  if (flags.selftest) {
    await runSelfTest(path.resolve(flags.selftest))
    return
  }
  if (!flags.background) {
    await askFirstRun()
    showWindow()
  }
}

if (flags.selftest && (!simulated || !flags.userData)) {
  // It changes settings and flies steps: only on a simulated aircraft, and only in a folder of its own.
  console.error('--selftest needs --preview or --demo (which never touch the simulator) and --user-data=FOLDER (so your own settings are left alone).')
  app.exit(2)
} else if (!flags.selftest && !app.requestSingleInstanceLock()) {
  app.quit() // a copy is already running: it opens its window (second-instance)
} else {
  void app.whenReady().then(main).catch((err: unknown) => {
    crashLog(`The app could not start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    app.exit(1)
  })
}

// ---- the self-test -------------------------------------------------------------------------------------------
// `Auto Step Climb.exe --preview --selftest=FOLDER --user-data=FOLDER2` starts the app on a simulated aircraft,
// with the window drawn into memory instead of onto the screen, and checks that it all works from the inside: the
// page loads and shows the state, the buttons reach the app, settings are saved, and a step is flown. It writes
// report.json and pictures of the window into FOLDER, and exits 0 when everything passed. It never touches the sim.

async function runSelfTest(outDir: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true })
  const checks: { name: string; ok: boolean; detail?: string }[] = []
  const check = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
  }
  const pictures: string[] = []
  const pageErrors: string[] = []

  const open = async (width: number, height: number): Promise<{ w: BrowserWindow; eval: <T>(code: string) => Promise<T>; shot: (name: string) => Promise<void> }> => {
    const w = createWindow({ offscreen: true, width, height })
    let latest: NativeImage | null = null
    w.webContents.on('paint', (_event, _dirty, image) => {
      latest = image
    })
    w.webContents.setFrameRate(10)
    w.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) pageErrors.push(message)
    })
    await w.loadURL(`${APP_ORIGIN}/index.html`)
    return {
      w,
      eval: <T>(code: string): Promise<T> => w.webContents.executeJavaScript(code) as Promise<T>,
      shot: async (name: string): Promise<void> => {
        w.webContents.invalidate()
        await sleep(700)
        const image = latest as NativeImage | null
        if (!image) throw new Error(`no picture of ${name}`)
        const file = path.join(outDir, `${name}.png`)
        fs.writeFileSync(file, image.toPNG())
        pictures.push(file)
      }
    }
  }

  try {
    // An aircraft the app does not control must be sent nothing, ever: count what reaches the aircraft.
    let sentToAircraft = 0
    if (flags.otherAircraft) {
      const execute = core.adapter.execute.bind(core.adapter)
      core.adapter.execute = (cmd) => {
        sentToAircraft++
        execute(cmd)
      }
    }
    // Tall, so the whole page is in the picture.
    const wide = await open(1100, 2400)
    const push = setInterval(() => {
      if (!wide.w.isDestroyed()) wide.w.webContents.send('autostep:state', core.getState())
    }, 500)
    await sleep(2500)

    check('the page can reach the app', await wide.eval<boolean>("typeof window.autostep === 'object' && typeof window.autostep.act === 'function'"))
    check('the page shows the aircraft state', await wide.eval<boolean>("document.getElementById('mode').textContent.length > 0 && document.getElementById('phase').textContent.length > 0"))
    check('settings are offered in the app', await wide.eval<boolean>("!document.getElementById('settingsCard').hidden"))
    const named = await wide.eval<{ chipHidden: boolean; chip: string; info: string; title: string }>(
      "({ chipHidden: document.getElementById('flightChip').hidden, chip: document.getElementById('flightChip').textContent, info: document.getElementById('planInfo').textContent, title: document.title })"
    )
    const planFlight = (core.getState() as { plan: { flight?: string } | null }).plan?.flight ?? ''
    check(
      'the window names the flight when the plan has one',
      named.chipHidden === (planFlight === '') && (planFlight === '' || (named.chip === planFlight && named.info.startsWith(planFlight) && named.title.includes(planFlight))),
      JSON.stringify({ planFlight, ...named })
    )
    // With a route in the plan the chart is to scale, and the aircraft's dot is on its line, before the first riser while that step is ahead.
    const eng = (core.getState() as { engine: { route: unknown; alongNm: number | null; steps: { atNm?: number | null; status: string }[] } }).engine
    const scaleExpected = eng.route !== null && eng.steps.length > 0 && eng.steps.every((x) => typeof x.atNm === 'number')
    const chart = await wide.eval<{ note: string; planeX: number | null; riserX: number | null }>(
      "(() => { const pl = document.querySelector('.plane-mark circle.plane'); const nd = document.querySelector('circle.node'); const note = document.querySelector('.key-note'); return { note: note ? note.textContent : '', planeX: pl ? Number(pl.getAttribute('cx')) : null, riserX: nd ? Number(nd.getAttribute('cx')) : null } })()"
    )
    const scaled = chart.note.startsWith('To scale')
    // The dot is on the side of the first step that the distance says: before its riser until the step's place is passed, after it from then on.
    const at0 = eng.steps[0]?.atNm
    const dotOk =
      chart.planeX === null ||
      chart.riserX === null ||
      eng.alongNm === null ||
      typeof at0 !== 'number' ||
      (chart.planeX >= 56 && (eng.alongNm > at0 ? chart.planeX >= chart.riserX - 0.5 : chart.planeX <= chart.riserX + 0.5))
    check('the chart is to scale along the route when the plan has one', scaled === scaleExpected && dotOk, JSON.stringify({ scaleExpected, ...chart, along: eng.alongNm, firstStepAt: at0 }))
    await wide.shot('1-window')

    await wide.eval("document.getElementById('settingsCard').open = true; document.getElementById('settingsCard').scrollIntoView({ block: 'end' })")
    await sleep(400)
    await wide.shot('2-settings')
    await wide.eval('window.scrollTo(0, 0)')

    // Buttons reach the app, and what goes wrong comes back as a message.
    const bad = await wide.eval<string>("window.autostep.act('set-simbrief', { username: 'a/b' }).then(() => 'accepted', (e) => e.message)")
    check('a bad SimBrief name is refused with a reason', /letters, digits/.test(bad), bad)
    const live = await wide.eval<string>("window.autostep.act('set-live', { enabled: true }).then(() => 'accepted', (e) => e.message)")
    check('a simulated run cannot be switched to live control', /simulated/.test(live), live)
    const unknown = await wide.eval<string>("window.autostep.act('constructor', {}).then(() => 'accepted', (e) => e.message)")
    check('an unknown button is refused', /Unknown action/.test(unknown), unknown)

    // The bug report: built from the state, written without the person in it. The self-test neither fills your
    // clipboard nor opens your browser.
    const copied = await wide.eval<string>("window.autostep.act('copy-report', {}).then((m) => m, (e) => 'ERROR ' + e.message)")
    check('Copy report builds a report', /^Report copied \(\d+ lines\)/.test(copied), copied)
    let who = ''
    try {
      who = os.userInfo().username
    } catch {
      // nothing to look for
    }
    const leaks = [os.homedir(), ...(who.length >= 3 ? [who] : [])].filter((x) => lastReport.toLowerCase().includes(x.toLowerCase()))
    check('the report describes the run and leaves out the person', lastReport.includes('AUTO STEP CLIMB: REPORT') && lastReport.includes('Preview') && leaks.length === 0, leaks.join(' | '))
    const issues = await wide.eval<string>("window.autostep.act('open-issues', {}).then((m) => String(m), (e) => 'ERROR ' + e.message)")
    check(
      'Report a problem opens only the set GitHub page, and nothing while none is set',
      issuesUrl() === '' ? /ERROR No bug report page/.test(issues) : issues === `Would open ${issuesUrl()}`,
      issues
    )
    const hidden = await wide.eval<boolean>("document.getElementById('reportProblem').hidden")
    check('the Report a problem button shows only when a page is set', hidden === (issuesUrl() === ''), String(hidden))

    // The guide and the licences come with the app.
    const guide = await wide.eval<string>("window.autostep.act('open-guide', {}).then((m) => String(m), (e) => 'ERROR ' + e.message)")
    check('Open the guide finds the guide that comes with the app', app.isPackaged ? /^Would open .*[\\/]USER-GUIDE\.txt$/.test(guide) : /^Would open .*[\\/]USER-GUIDE\.md$/.test(guide), guide)
    if (app.isPackaged) {
      const installDir = path.dirname(process.execPath)
      const missing = ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'GPL-3.0.txt', 'USER-GUIDE.txt', 'LICENSE.electron.txt', 'LICENSES.chromium.html'].filter((f) => !fs.existsSync(path.join(installDir, f)))
      check('the licence, the notices and the guide are installed with the app', missing.length === 0, missing.join(', '))
    }

    // Settings are written to config.json, next to what was already there.
    await wide.eval("window.autostep.act('set-confirm-each', { enabled: true })")
    const saved = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, 'utf8')) as { engine?: { confirmEachStep?: boolean } }) : {}
    check('a setting is saved to config.json', saved.engine?.confirmEachStep === true)
    await wide.eval("window.autostep.act('set-confirm-each', { enabled: false })")

    // "Climb anyway if BeyondATC does not clear it" is off until it is switched on, and is saved when it is.
    const offByDefault = (core.getState() as { engine: { atcClimbAnyway: boolean } }).engine.atcClimbAnyway === false
    await wide.eval("window.autostep.act('atc-climb-anyway', { enabled: true })")
    const savedAnyway = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, 'utf8')) as { engine?: { atcClimbAnyway?: boolean } }) : {}
    check('"climb anyway" is off by default and is saved when switched on', offByDefault && savedAnyway.engine?.atcClimbAnyway === true)
    await wide.eval("window.autostep.act('atc-climb-anyway', { enabled: false })")

    // "Ask BeyondATC for the steps in other aircraft" is off until it is switched on, and is saved when it is. (A run that
    // shows an aircraft the app does not control starts with it on, so it has nothing to say about the default.)
    if (!flags.otherAircraft) {
      const otherOff = (core.getState() as { engine: { atcOtherAircraft: boolean } }).engine.atcOtherAircraft === false
      await wide.eval("window.autostep.act('atc-other-aircraft', { enabled: true })")
      const savedOther = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, 'utf8')) as { engine?: { atcOtherAircraft?: boolean } }) : {}
      check('"ask BeyondATC in other aircraft" is off by default and is saved when switched on', otherOff && savedOther.engine?.atcOtherAircraft === true)
      await wide.eval("window.autostep.act('atc-other-aircraft', { enabled: false })")
    }

    // The weight check is on until it is switched off, and the choice is saved.
    const guardOn = (core.getState() as { engine: { weightGuard: boolean } }).engine.weightGuard === true
    await wide.eval("window.autostep.act('weight-guard', { enabled: false })")
    const savedGuard = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, 'utf8')) as { engine?: { weightGuard?: boolean } }) : {}
    check('the weight check is on by default and its choice is saved', guardOn && savedGuard.engine?.weightGuard === false)
    await wide.eval("window.autostep.act('weight-guard', { enabled: true })")

    // The page's own address serves its files and nothing else.
    const status = await wide.eval<number>("fetch('autostep://app/package.json').then((r) => r.status)")
    check('files other than the page are not served', status === 404, String(status))

    await wide.eval("document.getElementById('skinToggle').click()")
    await sleep(500)
    await wide.shot('3-cockpit-look')
    await wide.eval("document.getElementById('skinToggle').click()")

    const phone = await open(420, 3400)
    const pushPhone = setInterval(() => {
      if (!phone.w.isDestroyed()) phone.w.webContents.send('autostep:state', core.getState())
    }, 500)
    await sleep(2500)
    await phone.shot('4-narrow-window')
    await phone.eval("document.getElementById('settingsCard').open = true; document.getElementById('settingsCard').scrollIntoView({ block: 'end' })")
    await sleep(400)
    await phone.shot('4b-narrow-settings')
    const overflow = await phone.eval<number>('document.documentElement.scrollWidth - window.innerWidth')
    check('the window has no sideways scrolling when narrow', overflow <= 0, `${overflow}px`)

    // A step is flown by the simulated aircraft while the window is open.
    const steps = core.engine.status.steps
    if (steps.length === 0) {
      check('a step is flown', true, 'n/a: the plan has no steps')
    } else {
      const t0 = Date.now()
      while (Date.now() - t0 < 240_000 && !core.engine.status.steps.every((s) => s.status === 'done' || s.status === 'skipped')) await sleep(1000)
      const states = core.engine.status.steps.map((s) => `${s.step.label}: ${s.status}`)
      check('the step is flown', core.engine.status.steps.every((s) => s.status === 'done'), states.join('; '))
      await wide.shot('5-step-done')
      if (flags.otherAircraft) {
        // The aircraft climbed by itself; the app asked BeyondATC, said so, and sent the aircraft nothing.
        const caption = await wide.eval<string>("document.getElementById('autoMode').textContent")
        const stepNowHidden = await wide.eval<boolean>("document.getElementById('stepNow').hidden")
        check('for an aircraft the app does not control the window says it only asks BeyondATC', /Asks BeyondATC only/.test(caption) && stepNowHidden, `${caption} (Step now hidden: ${stepNowHidden})`)
        check('BeyondATC was asked and a notification said what it answered', selftestNotices.some((n) => /BeyondATC cleared/.test(n.title)), JSON.stringify(selftestNotices))
        check('nothing was sent to the aircraft', sentToAircraft === 0, String(sentToAircraft))
      }
    }

    // The launch: the sim's readings stop, and an A330 is parked at Heathrow, fed through the path real readings take.
    core.adapter.stop()
    const parkedAtHeathrow: Snapshot = {
      t: Date.now(),
      title: 'A330-300 iniBuilds',
      aircraftOk: true,
      onGround: true,
      lat: 51.4706,
      lon: -0.4619,
      altFt: 83,
      vsFpm: 0,
      mach: 0,
      gsKt: 0,
      weightKg: 190_000,
      fcuSelectedFt: 0,
      apTargetFt: 0,
      control: 'knob'
    }
    check('no window is open before the launch', win === null || win.isDestroyed())
    const launchStart = Date.now()
    while (Date.now() - launchStart < 20_000 && launch.phase !== 'launched') {
      core.latest = { ...parkedAtHeathrow, t: Date.now() }
      core.hooks.onSnapshot?.(core.latest)
      await sleep(1000)
    }
    await sleep(1500)
    check('the launch comes once the A330 has been parked at the airport for a few seconds', launch.phase === 'launched', launch.phase)
    check('the airport is named from the list that ships with the app', launch.place?.icao === 'EGLL', `${launch.place?.icao} ${launch.place?.name}`)
    const opened = win !== null && !win.isDestroyed()
    check('the window opens by itself', opened)
    check('and it does not take the keyboard from the sim', opened && win !== null && win.isVisible() && !win.isFocused())
    check('a notification names the airport', selftestNotices.some((n) => /EGLL/.test(n.title)), JSON.stringify(selftestNotices))
    if (win && !win.isDestroyed()) {
      win.close()
      await sleep(500)
    }
    check('closing the window leaves the app running', !quitting && tray !== null && !tray.isDestroyed() && (win === null || win.isDestroyed()))

    // What the real thing needs but a simulated run does not use: the aircraft profile and the SimConnect library.
    const shipped = loadProfiles(builtinProfiles)
    check('the A330 profile ships with the app', shipped.profiles.some((p) => /A330/.test(p.name)) && shipped.errors.length === 0, `${builtinProfiles}: ${shipped.profiles.map((p) => p.name).join(', ')} ${shipped.errors.join('; ')}`)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const simconnect = require('node-simconnect') as { open?: unknown }
    check('the SimConnect library loads (it is only loaded, never opened)', typeof simconnect.open === 'function')

    // The start-with-Windows entry, in the installed app only: switched on, read back, and switched off again.
    // Whatever the person had chosen is put back afterwards (the entry is shared with a copy that is really in use).
    if (app.isPackaged) {
      const before = readLoginItem()
      const turnedOn = await wide.eval<string>("window.autostep.act('set-login-item', { enabled: true }).then(() => 'ok', (e) => e.message)")
      const readBackOn = readLoginItem()
      let entry = ''
      try {
        entry = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'], { encoding: 'utf8' })
          .split(/\r?\n/)
          .filter((line) => line.toLowerCase().includes(path.basename(process.execPath).toLowerCase()))
          .join(' | ')
          .replace(/\s+/g, ' ')
      } catch {
        // the detail is a convenience
      }
      const turnedOff = await wide.eval<string>("window.autostep.act('set-login-item', { enabled: false }).then(() => 'ok', (e) => e.message)")
      check('Start with Windows can be switched on and off', turnedOn === 'ok' && readBackOn && turnedOff === 'ok' && !readLoginItem(), entry)
      if (before) setStartWithWindows(true)
    }

    check('the tray icon exists', tray !== null && !tray.isDestroyed())
    // Every part of the app, not only the main process: Chromium's graphics helper starts above normal. The app sets
    // them all back every few seconds, so wait for one pass after the last window was opened and closed.
    await sleep(6_000)
    const aboveNormal = app.getAppMetrics().flatMap((m) => {
      try {
        const p = os.getPriority(m.pid)
        return p < os.constants.priority.PRIORITY_BELOW_NORMAL ? [`${m.type} ${m.pid}: ${p}`] : []
      } catch {
        return []
      }
    })
    check('every part of the app runs at below-normal priority', aboveNormal.length === 0 && os.getPriority(process.pid) >= os.constants.priority.PRIORITY_BELOW_NORMAL, aboveNormal.join(' | '))
    check('no errors were reported by the page', pageErrors.length === 0, pageErrors.join(' | '))

    clearInterval(push)
    clearInterval(pushPhone)
  } catch (err) {
    check('the self-test ran to the end', false, err instanceof Error ? (err.stack ?? err.message) : String(err))
  }

  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, workingSetMB: Math.round(m.memory.workingSetSize / 1024) }))
  const failed = checks.filter((c) => !c.ok)
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(
      {
        ok: failed.length === 0,
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        mode: core.mode,
        startWithWindowsEntry: readLoginItem(),
        memory: metrics,
        checks,
        pictures
      },
      null,
      2
    )
  )
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`)
  for (const c of failed) console.log(`FAILED: ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
  quitting = true
  core.stop()
  app.exit(failed.length === 0 ? 0 : 1)
}
