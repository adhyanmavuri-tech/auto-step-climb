import fs from 'node:fs'
import path from 'node:path'
import { AirportIndex } from './airports.ts'
import { loadAppState, profileFingerprint, saveAppState } from './app-state.ts'
import type { AppState } from './app-state.ts'
import { BeyondAtcLink } from './beyondatc.ts'
import { loadConfig } from './config.ts'
import type { AppConfig } from './config.ts'
import { saveConfigValues, stripBom } from './config-write.ts'
import type { ConfigValue } from './config-write.ts'
import { DEMO_ENGINE_OPTIONS, DEMO_TIMING, DemoAdapter, makeDemoPlan, planLevelLabels } from './demo.ts'
import { StepClimbEngine } from './engine.ts'
import { FakeBeyondAtc } from './fake-beyondatc.ts'
import { fetchSimbriefOfp, manualPlan, parseSimbriefOfp } from './plan.ts'
import { loadProfiles } from './profile.ts'
import type { AircraftProfile } from './profile.ts'
import { buildReport } from './report.ts'
import type { ReportEnv, ReportState } from './report.ts'
import { SimConnectAdapter } from './sim.ts'
import type { SimAdapter } from './sim.ts'
import { formatSteps, parseStepLines } from './step-lines.ts'
import { trayStatus } from './tray-status.ts'
import type { TrayStatus } from './tray-status.ts'
import type { Command, FlightPlan, LogEntry, Snapshot } from './types.ts'

/**
 * Everything that makes the app work, with nothing about how it is shown: the engine, the sim, the flight plan,
 * the ATC link, the log and the settings. The command-line version (src/main.ts) puts a local dashboard in front
 * of it, the Windows app (electron/main.ts) puts a window and a tray icon in front of it. Both read the same
 * state (getState) and press the same buttons (actions).
 */

export type Host = 'cli' | 'app'
export type Mode = 'demo' | 'preview' | 'live' | 'dry-run'
export type ActionFn = (body: Record<string, unknown>) => unknown | Promise<unknown>

export interface CoreOptions {
  host: Host
  version: string
  /** A simulated aircraft instead of the sim: nothing then touches Microsoft Flight Simulator. */
  simulated: 'demo' | 'preview' | null
  /** Live control on from the start. "config" reads it from config.json (the Windows app); ignored for a simulated run. */
  live: boolean | 'config'
  configFile: string
  /** Folders of aircraft profiles. A folder that is missing is skipped. */
  profileDirs: string[]
  logDir: string
  /** Where the Windows app keeps what it remembers between runs. Unset: nothing is remembered. */
  stateFile?: string
  /** data/airports.json, to name the airport the aircraft is at. */
  airportsFile?: string
  /** The dashboard port of the command-line version, shown in the state. */
  port?: number
  /** Write settings changed in the window back to config.json (the Windows app). */
  persistSettings: boolean
  /** Also print the log to the console (the command-line version). */
  echo: boolean
  atcClimbAnyway?: boolean
  /** For the tests: the simulated aircraft is one the app has no profile for. */
  demoUnsupported?: boolean
  /**
   * For showing the BeyondATC-only mode: the simulated aircraft has no profile and climbs by itself at each step point,
   * and asking BeyondATC in other aircraft is switched on.
   */
  demoOtherAircraft?: boolean
}

/** What the host adds to the state and tells the core. */
export interface HostState {
  app?: Record<string, unknown>
  sim?: Record<string, unknown>
  launch?: unknown
}

export interface CoreHooks {
  /** Every reading from the sim (null: none), before the engine sees it. */
  onSnapshot?: (snap: Snapshot | null) => void
  /** Extra things for the window and the dashboard to show. */
  hostState?: () => HostState
  /** Why the app is about to close, when it is. */
  closing?: () => string | null
  /** The user asked to quit. */
  onQuit?: () => void
  /** A setting changed in the window that the host acts on. */
  onSettingChanged?: (key: 'openWindowAtAirport') => void
  /** Something the person should be told as it happens (BeyondATC's answer for an aircraft the app does not control). */
  onNotify?: (note: { title: string; text: string }) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const EMPTY_PLAN: FlightPlan = {
  source: 'manual',
  origin: '',
  destination: '',
  generatedAt: null,
  initialAltFt: 0,
  route: [],
  steps: []
}

const NO_PLAN: Record<Host, string> = {
  cli: 'No flight plan: set simbrief.username in config.json, or type your steps in the Steps box',
  app: 'No flight plan yet: enter your SimBrief username in Settings, or type your steps in the Steps box'
}

/** SimBrief user names are letters, digits, spaces, dots, dashes and underscores. */
export function cleanSimbriefName(raw: string): string {
  const name = raw.trim()
  if (name === '') return ''
  if (name.length > 64 || !/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    throw new Error('A SimBrief username has letters, digits, spaces, dots, dashes and underscores only')
  }
  return name
}

export class AutoStepCore {
  readonly opts: CoreOptions
  readonly config: AppConfig
  readonly engine: StepClimbEngine
  readonly airports: AirportIndex | null
  readonly profiles: AircraftProfile[]
  readonly actions: Record<string, ActionFn>
  hooks: CoreHooks = {}
  adapter!: SimAdapter
  atcLink!: BeyondAtcLink

  /** The newest reading from the sim, null while there is none. */
  latest: Snapshot | null = null
  /** True once a flight plan has been asked for (loaded or not) in this run. */
  planAttempted = false

  private readonly logs: LogEntry[] = []
  private readonly logFile: string
  private readonly warnings: string[]
  private readonly profileErrors: string[]
  private readonly fingerprints = new Map<string, string>()
  private readonly testedThisRun = new Set<string>()
  private appState: AppState
  private plan: FlightPlan | null = null
  /** The plan as loaded (OFP, file, manual or demo), before any edits in the step box. */
  private basePlan: FlightPlan | null = null
  private stepsText = ''
  private stepsEdited = false
  private planError: string | null = null
  private planLoaded = false
  /** True while the control test runs, so readings come quickly. */
  private testing = false
  private watchdog: NodeJS.Timeout | null = null

  private constructor(opts: CoreOptions) {
    this.opts = opts
    const loadedConfig = loadConfig(path.resolve(opts.configFile))
    this.config = loadedConfig.config
    this.warnings = loadedConfig.warnings
    if (opts.port !== undefined) this.config.port = opts.port

    this.logFile = path.join(opts.logDir, 'autostep.log')
    try {
      fs.mkdirSync(opts.logDir, { recursive: true })
    } catch {
      // the log file is a convenience; the app runs without it
    }

    const simulated = opts.simulated
    const live = simulated ? false : opts.live === 'config' ? this.config.live : opts.live
    this.engine = new StepClimbEngine({
      ...this.config.engine,
      ...(simulated === 'demo' ? DEMO_ENGINE_OPTIONS : simulated === 'preview' ? DEMO_TIMING : { live }),
      ...(opts.atcClimbAnyway ? { atcClimbAnyway: true } : {}),
      ...(simulated && opts.demoOtherAircraft ? { atcOtherAircraft: true } : {})
    })
    this.engine.onLog = (entry) => this.print(entry)

    // A simulated run has no real aircraft, so it needs no profiles.
    this.profiles = []
    this.profileErrors = []
    if (!simulated) {
      for (const dir of opts.profileDirs) {
        if (!fs.existsSync(dir)) continue
        const found = loadProfiles(dir)
        this.profiles.push(...found.profiles)
        this.profileErrors.push(...found.errors)
      }
    }
    for (const p of this.profiles) this.fingerprints.set(p.name, profileFingerprint(p))
    this.appState = opts.stateFile ? loadAppState(opts.stateFile) : { firstRunDone: false, controlTested: {} }
    this.airports = opts.airportsFile ? AirportIndex.tryLoad(opts.airportsFile) : null

    this.actions = this.makeActions()
  }

  /** Builds the core. A preview flies your real flight plan, so that is loaded here, before the simulated aircraft is made. */
  static async create(opts: CoreOptions): Promise<AutoStepCore> {
    const core = new AutoStepCore(opts)
    if (opts.simulated === 'preview') await core.loadInitialPlan()
    core.buildSimAndAtc()
    return core
  }

  get mode(): Mode {
    return this.opts.simulated ?? (this.engine.options.live ? 'live' : 'dry-run')
  }

  /** True while the engine is working the FCU or flying a step. */
  get busy(): boolean {
    return this.engine.actuating()
  }

  get appStateSnapshot(): AppState {
    return this.appState
  }

  // ---- logging -----------------------------------------------------------------------------

  log(level: LogEntry['level'], text: string): void {
    this.print({ at: Date.now(), level, text })
  }

  private print(entry: LogEntry): void {
    this.logs.push(entry)
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300)
    if (this.opts.echo) {
      const tag = entry.level === 'info' ? '   ' : entry.level === 'warn' ? 'WRN' : 'ERR'
      console.log(`${new Date(entry.at).toLocaleTimeString()} ${tag} ${entry.text}`)
    }
    // Everything is also appended to logs/autostep.log, so what the app did and why survives a long flight.
    try {
      if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > 2_000_000) fs.renameSync(this.logFile, `${this.logFile}.old`)
      fs.appendFileSync(this.logFile, `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.text}\n`)
    } catch {
      // logging must never take the app down
    }
  }

  // ---- start and stop ----------------------------------------------------------------------

  /** Says how the run started, and anything wrong with the settings, in the log. */
  announce(): void {
    const e = this.engine
    this.log(
      'info',
      `Session started: ${this.opts.version}, ${this.mode}, confirmEachStep=${e.options.confirmEachStep}, stepDowns=${e.options.stepDowns}, atcFirst=${e.options.atcFirst}, atcClimbAnyway=${e.options.atcClimbAnyway}, atcOtherAircraft=${e.options.atcOtherAircraft}, climbMode=${this.config.engine.climbMode}`
    )
    if (e.options.atcClimbAnyway) {
      this.log('warn', "Climb anyway is ON: when BeyondATC can't be asked or doesn't clear a step, the step is climbed anyway instead of skipped (only while Ask BeyondATC first is on)")
    }
    for (const w of this.warnings) this.log('warn', `config.json: ${w}`)
    for (const err of this.profileErrors) this.log('warn', `profile ${err}`)
    if (!this.opts.simulated && this.profiles.length === 0) this.log('error', 'No usable aircraft profile in the profiles folder, so nothing can be controlled')
    if (this.opts.host === 'cli' && this.config.engine.live && !e.options.live && !this.opts.simulated) {
      this.log('warn', 'engine.live in config.json is ignored - live control needs the --live flag')
    }
    if (this.config.engine.minCruiseAltFt < 15_000) {
      this.log('warn', `engine.minCruiseAltFt is ${this.config.engine.minCruiseAltFt} ft: steps can start at low altitude. That is for testing only.`)
    }
  }

  /** Loads the flight plan once (the preview does it earlier, because the simulated aircraft needs it). */
  async loadInitialPlan(): Promise<void> {
    if (this.planLoaded) return
    this.planLoaded = true
    await this.loadPlan()
  }

  /** Starts talking to the sim. */
  start(): void {
    // If the sim stops answering mid-step, fail safe instead of waiting forever.
    this.watchdog = setInterval(() => {
      if (this.adapter.connected && this.adapter.lastDataAt > 0 && Date.now() - this.adapter.lastDataAt > 5_000 && this.latest !== null) {
        this.latest = null
        this.dispatch(this.engine.tick(null))
      }
    }, 2_000)
    this.watchdog.unref()

    this.adapter.start((raw) => {
      const snap = this.forEngine(raw)
      this.latest = snap
      this.hooks.onSnapshot?.(snap)
      // An aircraft whose profile isn't verified can't act until it has passed a control test here.
      const profile = this.adapter.profile
      this.engine.setOptions({ controlReady: !profile || profile.verified || this.isControlTested(profile.name) })
      const o = this.engine.options
      this.dispatch(this.engine.tick(snap ? { ...snap, atc: o.atcFirst || o.atcOtherAircraft ? this.atcLink.state : null } : null))
    })
  }

  /**
   * The reading the engine and the window get. An aircraft the app has no profile for is "not supported" and left alone,
   * unless the person has switched on asking BeyondATC in other aircraft: then it is followed, marked as one the app does
   * not control ("none"), so the engine only asks the ATC program about its steps and never builds a command for it.
   * An aircraft that has a profile is never touched here, even when its controls are missing.
   */
  private forEngine(raw: Snapshot | null): Snapshot | null {
    if (!raw || raw.aircraftOk || this.adapter.profile !== null) return raw
    if (!this.engine.options.atcOtherAircraft) return raw
    if (raw.title === '' || (raw.lat === 0 && raw.lon === 0)) return raw // a menu or a loading screen
    return { ...raw, aircraftOk: true, control: 'none' }
  }

  stop(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.adapter.stop()
    this.atcLink.enable(false)
  }

  private buildSimAndAtc(): void {
    const opts = this.opts
    const live = this.engine.options.live
    this.adapter = opts.simulated
      ? new DemoAdapter(opts.simulated === 'demo' ? makeDemoPlan() : (this.basePlan ?? EMPTY_PLAN), { preview: opts.simulated === 'preview', unsupported: opts.demoUnsupported === true, otherAircraft: opts.demoOtherAircraft === true })
      : new SimConnectAdapter(this.profiles, {
          live,
          nextPollMs: () => (this.engine.wantsFastTick || this.testing ? 250 : 1000),
          log: (level, text) => this.log(level, text)
        })

    // In the demo and the preview a pretend BeyondATC answers, so the flow shows without any real program.
    const fakeAtc = opts.simulated
      ? new FakeBeyondAtc({
          delayMs: 700,
          levels: opts.simulated === 'preview' && this.basePlan ? planLevelLabels(this.basePlan) : ['FL340', 'FL360', 'FL380', 'FL400']
        })
      : null
    this.atcLink = new BeyondAtcLink({
      url: `ws://${this.config.atc.host}:${this.config.atc.port}`,
      log: (level, text) => this.log(level, text),
      ...(fakeAtc ? { createSocket: fakeAtc.createSocket } : {})
    })
    // The link contacts nothing unless one of the modes that need it is on.
    if (this.engine.options.atcFirst || this.engine.options.atcOtherAircraft) this.atcLink.enable(true)
  }

  /** Sends what the engine asked for: FCU and autopilot commands to the sim, requests to the ATC program, notes to the person. */
  private dispatch(cmds: Command[]): void {
    for (const cmd of cmds) {
      if (cmd.type === 'atc-request') this.atcLink.request(cmd.altFt)
      else if (cmd.type === 'atc-cancel') this.atcLink.cancel()
      else if (cmd.type === 'notify') this.hooks.onNotify?.({ title: cmd.title, text: cmd.text })
      else this.adapter.execute(cmd)
    }
  }

  // ---- flight plan -------------------------------------------------------------------------

  private applyPlan(next: FlightPlan | null, edited: boolean): void {
    this.plan = next
    this.stepsText = next ? formatSteps(next.steps) : ''
    this.stepsEdited = edited
    this.engine.setPlan(next)
  }

  private get hasPlanSource(): boolean {
    const c = this.config
    return Boolean(c.planFile || c.simbrief.username || c.simbrief.userId || c.manualSteps.length > 0)
  }

  /** The flight plan from wherever the settings say: the demo's, a saved OFP, the latest from SimBrief, or the steps typed in config.json. Null when there is nowhere to get one. */
  private async readPlanSource(): Promise<FlightPlan | null> {
    const cfg = this.config
    if (this.opts.simulated === 'demo') return makeDemoPlan()
    if (cfg.planFile) {
      const raw: unknown = JSON.parse(stripBom(fs.readFileSync(path.resolve(path.dirname(this.opts.configFile), cfg.planFile), 'utf8')))
      return parseSimbriefOfp(raw, { stepAt: cfg.stepAt })
    }
    if (cfg.simbrief.username || cfg.simbrief.userId) return parseSimbriefOfp(await fetchSimbriefOfp(cfg.simbrief), { stepAt: cfg.stepAt })
    if (cfg.manualSteps.length > 0) return manualPlan(cfg.manualSteps)
    return null
  }

  /** True when there is somewhere to get a flight plan from but none is loaded (the last try failed, or none was made yet). */
  get planMissing(): boolean {
    return this.plan === null && this.hasPlanSource
  }

  /**
   * Loads the flight plan from its source. With `keepOnError`, a plan that is already loaded stays when this
   * attempt fails (a refresh at the airport should not throw away a good plan because the network is down for a moment).
   */
  async loadPlan(options: { keepOnError?: boolean } = {}): Promise<string> {
    this.planAttempted = true
    this.planError = null
    try {
      const loaded = await this.readPlanSource()
      if (!loaded) this.planError = NO_PLAN[this.opts.host]
      if (loaded?.generatedAt) {
        const ageH = (Date.now() - Date.parse(loaded.generatedAt)) / 3_600_000
        if (ageH > 24) this.log('warn', `The OFP is ${Math.round(ageH)} hours old - is it the right flight?`)
      }
      this.basePlan = loaded
      this.applyPlan(loaded, false)
      return loaded ? `Loaded ${loaded.steps.length} step climb(s)` : (this.planError ?? 'No plan')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (options.keepOnError && this.plan) {
        this.planError = `Could not refresh the flight plan (${message}). Keeping the one already loaded.`
        this.log('warn', this.planError)
        return this.planError
      }
      this.basePlan = null
      this.planError = message
      this.applyPlan(null, false)
      this.log('error', `Could not load the flight plan: ${message}`)
      return message
    }
  }

  /**
   * Switches to a newer SimBrief flight plan if there is one: you generate the OFP, and it is picked up. A
   * plan is only replaced by one generated after it, never by the same one again, and never while a step is
   * being flown, after the steps were edited by hand, or for a plan that came from a file.
   */
  async refreshPlanIfNewer(): Promise<boolean> {
    const cfg = this.config
    if (this.opts.simulated || cfg.planFile || !(cfg.simbrief.username || cfg.simbrief.userId)) return false
    if (this.busy || this.stepsEdited) return false
    try {
      const next = await this.readPlanSource()
      if (!next?.generatedAt) return false
      const have = this.plan?.generatedAt
      if (have && Date.parse(next.generatedAt) <= Date.parse(have)) return false
      if (this.busy || this.stepsEdited) return false // something changed while it was being fetched
      this.basePlan = next
      this.planError = null
      this.applyPlan(next, false)
      this.log('info', `A newer flight plan was found: ${next.origin || '?'} -> ${next.destination || '?'}`)
      return true
    } catch {
      return false // the next try will do; a failed check is not worth a line in the log every minute
    }
  }

  private syncing = false

  /**
   * Brings the flight plan up to date for an A330 that is flying or parked. It loads the plan when there is none
   * (the app was started mid-flight, or the last try failed). When the aircraft is `parked` it also switches to a
   * newer OFP, so one generated at the gate is picked up; in the air the plan in use is never swapped.
   */
  async syncPlan(parked: boolean): Promise<void> {
    if (this.syncing || this.busy) return
    this.syncing = true
    try {
      if (!this.planAttempted || this.planMissing) await this.loadPlan({ keepOnError: true })
      else if (parked) await this.refreshPlanIfNewer()
    } finally {
      this.syncing = false
    }
  }

  private setSteps(text: string): string {
    if (this.busy) throw new Error('A step climb is in progress - press Stop first')
    const base = this.basePlan ?? EMPTY_PLAN
    const { steps, errors } = parseStepLines(text, base.route, base.initialAltFt)
    if (errors.length > 0) throw new Error(errors.join('\n'))
    this.applyPlan({ ...base, steps }, true)
    this.log('info', `Steps set by you: ${steps.map((s) => s.label).join(', ') || 'none'}`)
    return steps.length === 0 ? 'No steps - nothing will be flown' : `${steps.length} step(s) applied`
  }

  /** A warning when the aircraft is parked somewhere the flight plan does not start or end. */
  private planWarning(): string | null {
    const plan = this.plan
    const s = this.latest
    if (!plan || !plan.origin || !s || !s.onGround || !s.aircraftOk || this.opts.simulated || !this.airports) return null
    const here = this.airports.nearest(s, 6)?.airport.icao
    if (!here) return null
    const start = plan.origin.toUpperCase()
    const end = plan.destination.toUpperCase()
    if (here === start || here === end) return null
    return `The aircraft is at ${here}, but the flight plan is ${start} to ${end}. Is it the right flight?`
  }

  // ---- settings ----------------------------------------------------------------------------

  /** Writes settings to config.json (the Windows app only). A file that cannot be written is said in the log. */
  private persist(values: ConfigValue[]): void {
    if (!this.opts.persistSettings) return
    const result = saveConfigValues(this.opts.configFile, values)
    if (!result.ok) this.log('warn', result.reason)
  }

  /** Switches live control on or off. Off: the app only watches, reading the sim and logging what it would do. */
  setLive(on: boolean): string {
    if (this.opts.simulated) throw new Error('A simulated run cannot operate anything, so there is nothing to switch')
    if (this.opts.host !== 'app') throw new Error('Live control is set when the app starts (--live)')
    if (this.busy) throw new Error('A step climb is in progress - press Stop first')
    this.engine.setOptions({ live: on })
    this.adapter.setLive?.(on)
    this.config.live = on
    this.persist([{ path: ['live'], value: on }])
    this.log(on ? 'warn' : 'info', on ? 'Live control is ON: the app will operate the FCU at each step point' : 'Live control is off: watching only, nothing is sent to the aircraft')
    return on ? 'Live control is on' : 'Live control is off: watching only'
  }

  private setSimbrief(raw: string): string {
    const name = cleanSimbriefName(raw)
    this.config.simbrief = { username: name, userId: '' }
    this.persist([
      { path: ['simbrief', 'username'], value: name },
      { path: ['simbrief', 'userId'], value: '' }
    ])
    this.log('info', name ? `SimBrief username set to ${name}` : 'SimBrief username cleared')
    if (this.busy) return 'Saved. The flight plan is loaded when no step is in progress.'
    void this.loadPlan()
    return name ? 'Saved. Loading your latest flight plan...' : 'Saved'
  }

  // ---- control test ------------------------------------------------------------------------

  isControlTested(name: string): boolean {
    if (this.testedThisRun.has(name)) return true
    const print = this.fingerprints.get(name)
    return print !== undefined && this.appState.controlTested[name] === print
  }

  /**
   * Changes the FCU altitude by one small step and back, then checks it followed. The autopilot mode
   * is not touched (no push or pull). Passing it unlocks live control for an unverified profile.
   */
  private async controlTest(): Promise<string> {
    if (this.mode === 'dry-run') {
      throw new Error(`The control test sends input to the sim, so ${this.opts.host === 'app' ? 'turn on Live control first' : 'it needs --live'}`)
    }
    const profile = this.adapter.profile
    const start = this.latest
    if (!start?.aircraftOk || !profile) throw new Error('No supported aircraft is loaded')
    if (this.busy) throw new Error('A step climb is in progress')
    if (this.testing) throw new Error('A control test is already running')

    this.testing = true
    try {
      const before = start.fcuSelectedFt
      const knob = profile.control === 'knob'
      this.log('info', `Control test (${profile.name}): ${knob ? 'one click up, then one click down' : 'a 100 ft change up, then back'}. The autopilot mode is not changed.`)
      this.adapter.execute(knob ? { type: 'fcu-click', dir: 1 } : { type: 'set-altitude', ft: before + 100 })
      await sleep(2000)
      const mid = this.latest?.fcuSelectedFt ?? NaN
      this.adapter.execute(knob ? { type: 'fcu-click', dir: -1 } : { type: 'set-altitude', ft: before })
      await sleep(2000)
      const after = this.latest?.fcuSelectedFt ?? NaN
      const ok = Number.isFinite(mid) && mid !== before && Math.abs(after - before) < 1
      if (ok) this.markControlTested(profile.name)
      const text = `FCU selected altitude ${before} -> ${mid} -> ${after}: the controls ${ok ? 'work' : 'did NOT behave as expected'}`
      this.log(ok ? 'info' : 'error', `Control test: ${text}`)
      return text
    } finally {
      this.testing = false
    }
  }

  /** Records a passed control test: for this run, and for later runs while the profile stays as it is. */
  markControlTested(name: string): void {
    this.testedThisRun.add(name)
    const print = this.fingerprints.get(name)
    if (this.opts.stateFile && print) {
      this.appState = { ...this.appState, controlTested: { ...this.appState.controlTested, [name]: print } }
      saveAppState(this.opts.stateFile, this.appState)
    }
  }

  /** Remembers that the first-run question has been asked. */
  markFirstRunDone(): void {
    this.appState = { ...this.appState, firstRunDone: true }
    if (this.opts.stateFile) saveAppState(this.opts.stateFile, this.appState)
  }

  // ---- state for the window and the dashboard ----------------------------------------------

  getState(): Record<string, unknown> {
    const s = this.latest
    const extra = this.hooks.hostState?.() ?? {}
    const cfg = this.config
    const isApp = this.opts.host === 'app'
    const profile = this.adapter.profile
    return {
      app: {
        version: this.opts.version,
        host: this.opts.host,
        mode: this.mode,
        port: isApp ? null : cfg.port,
        confirmEachStep: this.engine.options.confirmEachStep,
        ...extra.app
      },
      sim: {
        kind: this.adapter.kind,
        connected: this.adapter.connected,
        dataAgeMs: this.adapter.lastDataAt ? Date.now() - this.adapter.lastDataAt : null,
        title: s?.title ?? null,
        aircraftOk: s?.aircraftOk ?? false,
        profile: profile && {
          name: profile.name,
          verified: profile.verified,
          control: profile.control,
          tested: this.isControlTested(profile.name)
        },
        ...extra.sim
      },
      aircraft: s && {
        altFt: s.altFt,
        vsFpm: s.vsFpm,
        mach: s.mach,
        gsKt: s.gsKt,
        weightKg: s.weightKg,
        fcuSelectedFt: s.fcuSelectedFt,
        apTargetFt: s.apTargetFt,
        onGround: s.onGround
      },
      engine: this.engine.status,
      atc: {
        enabled: this.engine.options.atcFirst || this.engine.options.atcOtherAircraft,
        connected: this.atcLink.state.connected,
        autoRespond: this.atcLink.autoRespond,
        request: this.atcLink.state.request
      },
      plan: this.plan && {
        source: this.plan.source,
        edited: this.stepsEdited,
        origin: this.plan.origin,
        destination: this.plan.destination,
        flight: this.plan.flight ?? '',
        generatedAt: this.plan.generatedAt,
        initialAltFt: this.plan.initialAltFt
      },
      planWarning: this.planWarning(),
      stepsText: this.stepsText,
      planError: this.planError ?? (isApp && !this.planAttempted && !this.hasPlanSource ? NO_PLAN.app : null),
      settings: isApp
        ? {
            simbriefUsername: cfg.simbrief.username,
            simbriefUserId: cfg.simbrief.userId !== '',
            live: this.engine.options.live && !this.opts.simulated,
            confirmEachStep: this.engine.options.confirmEachStep,
            openWindowAtAirport: cfg.openWindowAtAirport,
            /** Nothing yet to get a flight plan from: the window opens its Settings and asks for a SimBrief username. */
            needsPlanSource: !this.hasPlanSource,
            configFile: this.opts.configFile
          }
        : null,
      launch: extra.launch ?? null,
      logs: this.logs.slice(-120)
    }
  }

  /** What the tray icon shows: a colour, a hover text and a status line. */
  getTray(): TrayStatus {
    const s = this.latest
    return trayStatus({
      mode: this.mode,
      sim: { connected: this.adapter.connected, hasData: s !== null, aircraftOk: s?.aircraftOk ?? false },
      engine: this.engine.status,
      planError: this.planError,
      closing: this.hooks.closing?.() ?? null
    })
  }

  /**
   * The text for a bug report: the state, the versions and the newest log lines, with what identifies the person
   * (their SimBrief name and ID, the Windows user name and the folders under it) blanked out. Nothing is sent.
   */
  buildReport(env: ReportEnv): string {
    return buildReport(this.getState() as unknown as ReportState, env, {
      secrets: { simbriefUsername: this.config.simbrief.username, simbriefUserId: this.config.simbrief.userId }
    })
  }

  // ---- buttons -----------------------------------------------------------------------------

  private makeActions(): Record<string, ActionFn> {
    const stopFirst = (): void => {
      if (this.busy) throw new Error('A step climb is in progress - press Stop first')
    }
    const actions: Record<string, ActionFn> = {
      enable: (body) => this.engine.setOptions({ enabled: body.enabled === true }),
      'atc-first': (body) => {
        const on = body.enabled === true
        this.engine.setOptions({ atcFirst: on })
        const needed = on || this.engine.options.atcOtherAircraft
        if (!needed) this.atcLink.cancel()
        this.atcLink.enable(needed)
        this.persist([{ path: ['engine', 'atcFirst'], value: on }])
        this.log('info', on ? 'Ask ATC first: on. Each step waits for a BeyondATC clearance' : 'Ask ATC first: off')
      },
      'atc-other-aircraft': (body) => {
        const on = body.enabled === true
        this.engine.setOptions({ atcOtherAircraft: on })
        const needed = on || this.engine.options.atcFirst
        if (!needed) this.atcLink.cancel()
        this.atcLink.enable(needed)
        this.persist([{ path: ['engine', 'atcOtherAircraft'], value: on }])
        this.log(
          'info',
          on
            ? 'Ask BeyondATC in other aircraft: on. An aircraft the app does not control is followed and BeyondATC is asked for its steps; nothing is sent to the aircraft'
            : 'Ask BeyondATC in other aircraft: off. Aircraft the app does not control are left alone'
        )
      },
      'atc-climb-anyway': (body) => {
        const on = body.enabled === true
        this.engine.setOptions({ atcClimbAnyway: on })
        this.persist([{ path: ['engine', 'atcClimbAnyway'], value: on }])
        this.log(
          on ? 'warn' : 'info',
          on
            ? "Climb anyway: on. When BeyondATC can't be asked or doesn't clear a step, the step is climbed anyway (only while Ask BeyondATC first is on)"
            : "Climb anyway: off. A step BeyondATC doesn't clear is skipped"
        )
      },
      'step-downs': (body) => {
        const on = body.enabled === true
        this.engine.setOptions({ stepDowns: on })
        this.persist([{ path: ['engine', 'stepDowns'], value: on }])
        this.log('info', `Step downs ${on ? "on: the OFP's step descents will be flown" : 'off: the aircraft stays at the higher level'}`)
      },
      confirm: () => this.engine.confirm(),
      'step-now': () => this.engine.stepNow(),
      skip: () => this.engine.skipNext(),
      abort: () => this.engine.abort(),
      'reload-plan': () => {
        stopFirst()
        return this.loadPlan()
      },
      'set-steps': (body) => this.setSteps(typeof body.text === 'string' ? body.text : ''),
      'reset-steps': () => {
        stopFirst()
        this.applyPlan(this.basePlan, false)
        return 'Steps reset to the plan'
      },
      'control-test': () => this.controlTest(),
      quit: () => {
        stopFirst()
        this.log('info', 'Quit requested: closing the app')
        setTimeout(() => this.hooks.onQuit?.(), 300)
        return 'Closing the app'
      }
    }
    if (this.opts.host === 'app') {
      actions['set-live'] = (body) => this.setLive(body.enabled === true)
      actions['set-confirm-each'] = (body) => {
        const on = body.enabled === true
        this.engine.setOptions({ confirmEachStep: on })
        this.persist([{ path: ['engine', 'confirmEachStep'], value: on }])
        this.log('info', on ? 'Confirm each step: on. Each step waits for you to press Confirm step' : 'Confirm each step: off. Steps start by themselves')
        return on ? 'Each step now waits for your confirmation' : 'Steps now start by themselves'
      }
      actions['set-simbrief'] = (body) => this.setSimbrief(typeof body.username === 'string' ? body.username : '')
      actions['set-window-at-airport'] = (body) => {
        const on = body.enabled === true
        this.config.openWindowAtAirport = on
        this.persist([{ path: ['openWindowAtAirport'], value: on }])
        this.hooks.onSettingChanged?.('openWindowAtAirport')
      }
    }
    return actions
  }
}
