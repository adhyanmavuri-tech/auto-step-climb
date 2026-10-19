import { EventFlag, open, Protocol, SimConnectConstants, SimConnectDataType, SimConnectPeriod } from 'node-simconnect'
import type { ConnectionHandle, OpenEvent, RawBuffer } from 'node-simconnect'
import { planCommand } from './actions.ts'
import type { Primitive } from './actions.ts'
import { inputEventsUsed, pickProfile } from './profile.ts'
import type { AircraftProfile, ControlKind } from './profile.ts'
import type { SimCommand, Snapshot } from './types.ts'

const APP_NAME = 'Auto Step Climb'
const REQ_ENUM = 1
const LB_TO_KG = 0.45359237
const RECONNECT_MS = 5_000
const DEFAULT_FCU_VAR = 'AUTOPILOT ALTITUDE LOCK VAR'
/** NotificationPriority.HIGHEST (a const enum in node-simconnect, so its value is spelled out here). */
const PRIORITY_HIGHEST = 1

export type AdapterLog = (level: 'info' | 'warn' | 'error', text: string) => void

/** The profile in use for the loaded aircraft. */
export interface ActiveProfileInfo {
  name: string
  verified: boolean
  control: ControlKind
}

/** What main.ts needs from a sim: readings in, commands out. */
export interface SimAdapter {
  readonly kind: 'simconnect' | 'demo'
  readonly connected: boolean
  /** Date.now() of the last reading, 0 if none yet. */
  readonly lastDataAt: number
  /** The profile matched to the loaded aircraft, if any. */
  readonly profile: ActiveProfileInfo | null
  start(onSnapshot: (s: Snapshot | null) => void): void
  execute(cmd: SimCommand): void
  stop(): void
  /** Turns live control on or off while running (the Windows app does it from its window). A simulated sim has no use for it. */
  setLive?(live: boolean): void
}

export interface SimConnectAdapterOptions {
  /** false = never send anything to the sim, whatever the engine asks. */
  live: boolean
  /** How long to wait before the next reading. */
  nextPollMs: () => number
  log: AdapterLog
}

const bigintSafe = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)
const unitFor = (varName: string): string => (varName.startsWith('L:') ? 'number' : 'feet')

/**
 * The real thing: talks to MSFS 2024 over SimConnect (node-simconnect). Reads a handful of SimVars
 * and operates the FCU through the controls named in the profile that matches the loaded aircraft.
 * An aircraft with no profile is read but never controlled.
 */
export class SimConnectAdapter implements SimAdapter {
  readonly kind = 'simconnect'
  lastDataAt = 0

  private readonly profiles: AircraftProfile[]
  private opts: SimConnectAdapterOptions
  private handle: ConnectionHandle | null = null
  private connecting = false
  private stopped = false
  private onSnapshot: ((s: Snapshot | null) => void) | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly inputEvents = new Map<string, bigint>()
  private readonly keyEventIds = new Map<string, number>()
  private nextKeyEventId = 1000
  private current: AircraftProfile | null = null
  private title = ''
  private enumStart = 0
  private lastChunk = 0
  private warnedMissing = false
  /** Each rebuild of the data definition gets a new id, so a late reply to an old one is ignored. */
  private nextDefId = 1
  private defId = 0

  constructor(profiles: AircraftProfile[], opts: SimConnectAdapterOptions) {
    this.profiles = profiles
    this.opts = opts
  }

  get connected(): boolean {
    return this.handle !== null
  }

  get profile(): ActiveProfileInfo | null {
    const p = this.current
    return p ? { name: p.name, verified: p.verified, control: p.control } : null
  }

  start(onSnapshot: (s: Snapshot | null) => void): void {
    this.onSnapshot = onSnapshot
    void this.connect()
  }

  setLive(live: boolean): void {
    this.opts = { ...this.opts, live }
  }

  stop(): void {
    this.stopped = true
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    try {
      this.handle?.close()
    } catch {
      // already closed
    }
    this.handle = null
  }

  execute(cmd: SimCommand): void {
    const profile = this.current
    if (!profile) {
      this.opts.log('warn', `Ignored ${cmd.type}: no profile for the loaded aircraft`)
      return
    }
    if (!this.opts.live) {
      this.opts.log('info', `[watching only] not sending ${JSON.stringify(cmd)}`)
      return
    }
    for (const p of planCommand(profile, cmd)) {
      if (p.delayMs <= 0) this.send(p)
      else setTimeout(() => this.send(p), p.delayMs)
    }
  }

  // ---- connection ------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.stopped || this.handle || this.connecting) return
    this.connecting = true
    try {
      let opened: OpenEvent
      try {
        opened = await open(APP_NAME, Protocol.SunRise) // MSFS 2024
      } catch {
        opened = await open(APP_NAME, Protocol.KittyHawk) // MSFS 2020 wire protocol
      }
      this.attach(opened.handle)
    } catch {
      this.scheduleReconnect() // the sim isn't up yet
    } finally {
      this.connecting = false
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, RECONNECT_MS)
  }

  private attach(handle: ConnectionHandle): void {
    this.handle = handle
    this.title = ''
    this.current = null
    this.warnedMissing = false
    this.keyEventIds.clear()
    this.opts.log('info', this.opts.live ? 'Connected to the simulator (live control is on)' : 'Connected to the simulator (watching only: it reads and sends nothing)')

    this.rebuildDefinition()
    handle.on('simObjectData', (d) => {
      if (d.requestID === this.defId) this.onData(d.data)
    })
    handle.on('inputEventsList', (recv) => {
      this.lastChunk = Date.now()
      for (const e of recv.inputEventDescriptors) this.inputEvents.set(e.name, e.inputEventIdHash)
    })
    handle.on('exception', (ex) => this.opts.log('warn', `SimConnect exception: ${JSON.stringify(ex, bigintSafe)}`))
    const gone = (): void => this.onGone()
    handle.on('close', gone)
    handle.on('quit', gone)
    handle.on('error', gone)

    this.requestInputEvents()
    this.poll()
  }

  /** (Re)defines what is read each cycle. The FCU SimVars come from the aircraft's profile. */
  private rebuildDefinition(): void {
    const handle = this.handle
    if (!handle) return
    if (this.defId !== 0) handle.clearDataDefinition(this.defId)
    this.defId = this.nextDefId++

    const T = SimConnectDataType
    const fcu = this.current?.simVars.fcuSelectedFt ?? DEFAULT_FCU_VAR
    const ap = this.current?.simVars.apTargetFt ?? DEFAULT_FCU_VAR
    const fields: [string, string | null, SimConnectDataType][] = [
      ['TITLE', null, T.STRING256],
      ['SIM ON GROUND', 'bool', T.INT32],
      ['PLANE LATITUDE', 'degrees', T.FLOAT64],
      ['PLANE LONGITUDE', 'degrees', T.FLOAT64],
      ['INDICATED ALTITUDE', 'feet', T.FLOAT64],
      ['VERTICAL SPEED', 'feet per minute', T.FLOAT64],
      ['AIRSPEED MACH', 'mach', T.FLOAT64],
      ['GROUND VELOCITY', 'knots', T.FLOAT64],
      ['TOTAL WEIGHT', 'pounds', T.FLOAT64],
      [fcu, unitFor(fcu), T.FLOAT64],
      [ap, unitFor(ap), T.FLOAT64]
    ]
    for (const [name, unit, type] of fields) handle.addToDataDefinition(this.defId, name, unit, type)
  }

  private onGone(): void {
    if (!this.handle) return
    this.handle = null
    this.inputEvents.clear()
    this.current = null
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.opts.log('warn', 'Lost the connection to the simulator')
    this.onSnapshot?.(null)
    this.scheduleReconnect()
  }

  private requestInputEvents(): void {
    this.inputEvents.clear()
    this.enumStart = Date.now()
    this.lastChunk = 0
    this.handle?.enumerateInputEvents(REQ_ENUM)
  }

  private poll(): void {
    if (!this.handle || this.stopped) return
    this.handle.requestDataOnSimObject(this.defId, this.defId, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE)
    this.pollTimer = setTimeout(() => this.poll(), this.opts.nextPollMs())
  }

  // ---- readings --------------------------------------------------------------------------

  /** Input events arrive in chunks; call it settled once they stop coming. */
  private eventsSettled(): boolean {
    const now = Date.now()
    return now - this.enumStart > 2_500 && (this.lastChunk === 0 || now - this.lastChunk > 1_200)
  }

  private onData(data: RawBuffer): void {
    const title = data.readString256()
    const onGround = data.readInt32() === 1
    const lat = data.readFloat64()
    const lon = data.readFloat64()
    const altFt = data.readFloat64()
    const vsFpm = data.readFloat64()
    const mach = data.readFloat64()
    const gsKt = data.readFloat64()
    const weightLb = data.readFloat64()
    const fcuSelectedFt = data.readFloat64()
    const apTargetFt = data.readFloat64()
    this.lastDataAt = Date.now()

    if (title !== this.title) this.onAircraftChanged(title)
    if (!this.eventsSettled()) {
      this.onSnapshot?.(null)
      return
    }

    const profile = this.current
    const missing = profile ? inputEventsUsed(profile).filter((n) => !this.inputEvents.has(n)) : []
    if (profile && missing.length > 0 && !this.warnedMissing) {
      this.warnedMissing = true
      this.opts.log('error', `"${profile.name}" needs input events this aircraft doesn't have: ${missing.join(', ')}. An update may have renamed them - run "npm run discover" and fix the profile.`)
    }

    this.onSnapshot?.({
      t: Date.now(),
      title,
      aircraftOk: profile !== null && missing.length === 0,
      onGround,
      lat,
      lon,
      altFt,
      vsFpm,
      mach,
      gsKt,
      weightKg: weightLb * LB_TO_KG,
      fcuSelectedFt,
      apTargetFt,
      control: profile?.control ?? 'knob'
    })
  }

  private onAircraftChanged(title: string): void {
    this.title = title
    this.warnedMissing = false
    this.current = pickProfile(this.profiles, title)
    if (!title) {
      this.opts.log('info', 'Aircraft: (none loaded)')
    } else if (this.current) {
      this.opts.log('info', `Aircraft: ${title} - profile "${this.current.name}"${this.current.verified ? '' : ' (not verified yet)'}`)
    } else {
      this.opts.log('warn', `Aircraft: ${title} - no profile for it, so it is read but never controlled. Run "npm run discover -- --write-profile" to draft one.`)
    }
    this.rebuildDefinition() // the new profile may read other SimVars
    this.requestInputEvents() // the input event list belongs to the loaded aircraft
  }

  // ---- sending ---------------------------------------------------------------------------

  private send(p: Primitive): void {
    if (p.kind === 'input') this.sendInput(p.name, p.value)
    else this.sendKey(p.name, p.data)
  }

  private sendInput(name: string, value: number): boolean {
    const hash = this.inputEvents.get(name)
    if (!this.handle || hash === undefined) {
      this.opts.log('error', `Cannot send ${name}: not connected or the event does not exist on this aircraft`)
      return false
    }
    try {
      this.handle.setInputEvent(hash, value)
      return true
    } catch (err) {
      this.opts.log('error', `Sending ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private sendKey(name: string, data: number): boolean {
    const handle = this.handle
    if (!handle) {
      this.opts.log('error', `Cannot send ${name}: not connected`)
      return false
    }
    try {
      let id = this.keyEventIds.get(name)
      if (id === undefined) {
        id = this.nextKeyEventId++
        handle.mapClientEventToSimEvent(id, name)
        this.keyEventIds.set(name, id)
      }
      handle.transmitClientEvent(
        SimConnectConstants.OBJECT_ID_USER,
        id,
        Math.max(0, Math.round(data)),
        PRIORITY_HIGHEST,
        EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY
      )
      return true
    } catch (err) {
      this.opts.log('error', `Sending ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}
