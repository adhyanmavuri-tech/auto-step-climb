import type { AtcRequestState, AtcState } from './types.ts'
import { WebSocketClient } from './ws-client.ts'

/**
 * Asks BeyondATC for a new cruise level, the way a pilot does from its toolbar. BeyondATC has no
 * official interface for other programs, but its toolbar talks to it over a local WebSocket
 * (ws://127.0.0.1:41716) in plain text, and community tools use the same connection. This file is
 * written from what those tools document; the format can change with a BeyondATC update, so every
 * failure here ends as "ATC did not clear it" and the step simply doesn't start.
 *
 * Messages arrive as "Prefix: payload". The ones used here:
 *   Actions: [Request Altitude Change¬Request Direct¬]   what the pilot can ask for right now
 *   ATC: roger, new cruise altitude FL360                what the controller said
 *   AutoRespond: true                                    the copilot reads ATC back for you
 * and the pilot's side is "set_action: <label>", one of the Actions on offer.
 *
 * The connection is our own small WebSocket client (src/ws-client.ts), not Node's built-in one. On the
 * first real flight (2026-10-17) the built-in one received nothing but empty strings: BeyondATC
 * compresses its messages whenever the client offers compression, which Node's always does. So the
 * app asked for FL380 and never saw the menu BeyondATC answered with, and the controller went on asking
 * "say again altitude" for hours. Because that left it deaf, the code below was also changed to
 * make a request without waiting for a list, and to cancel a request it cannot finish.
 */

const FT_PER_M = 3.28084
/** A menu level counts as the one asked for when it is this close, in feet: FL401 is 12,200 m. */
const MATCH_FT = 150
/** The separator BeyondATC puts between the items of an Actions list. */
const SEP = '¬'

export type AtcSource = 'atc' | 'atcTraffic' | 'player' | 'traffic' | 'cpdlcAtc' | 'cpdlcPilot'

export type AtcMessage =
  | { kind: 'actions'; items: string[] }
  | { kind: 'log'; source: AtcSource; text: string }
  | { kind: 'autoRespond'; value: boolean }
  | { kind: 'autoTune'; value: boolean }
  | { kind: 'other'; prefix: string }

const LOG_PREFIXES: Record<string, AtcSource> = {
  ATC: 'atc',
  ATCTraffic: 'atcTraffic',
  Player: 'player',
  Traffic: 'traffic',
  CPDLC_ATC: 'cpdlcAtc',
  CPDLC_Pilot: 'cpdlcPilot'
}

/** "[a¬b¬c¬]" -> ["a", "b", "c"]. Older versions separated with commas. */
export function parseActions(payload: string): string[] {
  let body = payload.trim()
  if (body.startsWith('[')) body = body.slice(1)
  if (body.endsWith(']')) body = body.slice(0, -1)
  return (body.includes(SEP) ? body.split(SEP) : body.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

const parseBool = (payload: string): boolean | null => {
  const v = payload.trim().toLowerCase()
  return v === 'true' ? true : v === 'false' ? false : null
}

/** One frame from BeyondATC. Returns null for anything that isn't a "Prefix: payload" line. */
export function parseMessage(frame: string): AtcMessage | null {
  const raw = frame.replace(/\r?\n$/, '')
  const colon = raw.indexOf(':')
  const prefix = colon > 0 ? raw.slice(0, colon) : raw.trim()
  const payload = colon > 0 ? raw.slice(colon + 1).replace(/^ /, '') : ''
  if (prefix === '') return null

  if (Object.hasOwn(LOG_PREFIXES, prefix)) return { kind: 'log', source: LOG_PREFIXES[prefix]!, text: payload.trim() }
  switch (prefix) {
    case 'Actions':
      return { kind: 'actions', items: parseActions(payload) }
    case 'AutoRespond': {
      const value = parseBool(payload)
      return value === null ? { kind: 'other', prefix } : { kind: 'autoRespond', value }
    }
    case 'AutoTune': {
      const value = parseBool(payload)
      return value === null ? { kind: 'other', prefix } : { kind: 'autoTune', value }
    }
    default:
      return { kind: 'other', prefix }
  }
}

/** A level as BeyondATC writes it ("FL360", "11,300m", "36,000 ft") in feet, or null if it isn't one. */
export function labelToFeet(label: string): number | null {
  const t = label.trim()
  const fl = /^(?:FL|flight level)\s*(\d{2,3})$/i.exec(t)
  if (fl) return Number(fl[1]) * 100
  const metric = /^(\d[\d,. ]*)\s*(?:m|metres|meters)$/i.exec(t)
  if (metric) {
    const metres = Number(metric[1]!.replace(/[,\s]/g, ''))
    return Number.isFinite(metres) && metres > 0 ? Math.round(metres * FT_PER_M) : null
  }
  const feet = /^(\d[\d,]*)\s*(?:ft|feet)$/i.exec(t)
  if (feet) {
    const n = Number(feet[1]!.replace(/,/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

const REFUSAL = /\b(unable|negative|cannot|can't|not (?:available|approved|possible|authori[sz]ed)|denied)\b/i
const CLEARING = /new cruise altitude|climb|descend|maintain|cleared/i
const ALTITUDE = /\b(?:FL|flight level)\s*(\d{2,3})\b|(\d[\d,]*)\s*(m|metres|meters|ft|feet)\b/gi

/** What a controller's line means for a request for `wantedFt`: cleared, refused, or neither. */
export function judgeReply(text: string, wantedFt: number): 'granted' | 'refused' | null {
  if (REFUSAL.test(text)) return 'refused'
  if (!CLEARING.test(text)) return null
  for (const m of text.matchAll(ALTITUDE)) {
    const ft = m[1] ? Number(m[1]) * 100 : labelToFeet(`${m[2]}${m[3]}`)
    if (ft !== null && Math.abs(ft - wantedFt) <= MATCH_FT) return 'granted'
  }
  return null
}

const fl = (ft: number): string => `FL${Math.round(ft / 100)}`
const REQUEST_LABEL = 'Request Altitude Change'
const CANCEL_LABEL = 'Cancel Altitude Change'
const REQUEST_ALTITUDE = /^request altitude change$/i
const CANCEL = /^cancel/i

// ---- the connection --------------------------------------------------------------------------

/** The part of a WebSocket this needs, so tests can stand in for BeyondATC. */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface BeyondAtcOptions {
  url: string
  log: (level: 'info' | 'warn' | 'error', text: string) => void
  createSocket?: (url: string) => SocketLike
  /** How long to wait for "Request Altitude Change" to be on offer. */
  menuWaitMs?: number
  /** How long to wait for the level menu after choosing it. */
  levelsWaitMs?: number
  /** How long to wait for the controller's answer after choosing a level. */
  grantWaitMs?: number
  reconnectMs?: number
}

type Stage = 'offer' | 'levels' | 'grant'

interface InFlight {
  altFt: number
  stage: Stage
  timer: NodeJS.Timeout | null
}

/**
 * One request at a time: choose "Request Altitude Change", choose the level from the menu BeyondATC
 * offers, then wait for the controller to say the new cruise altitude. The engine only reads
 * `state`, so the whole thing stays testable without BeyondATC.
 */
export class BeyondAtcLink {
  private readonly opts: Required<BeyondAtcOptions>
  private wanted = false
  private socket: SocketLike | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private isConnected = false
  private warnedDown = false
  /**
   * What BeyondATC last said is on offer. null: it has said nothing since we connected, or what it said is
   * out of date because a button has been pressed since.
   */
  private actions: string[] | null = null
  private auto: boolean | null = null
  private req: AtcRequestState | null = null
  private flight: InFlight | null = null

  constructor(opts: BeyondAtcOptions) {
    this.opts = {
      createSocket: (url) => new WebSocketClient(url),
      menuWaitMs: 20_000,
      levelsWaitMs: 30_000, // the pilot's call is spoken, and the controller answers it, before the menu follows
      grantWaitMs: 60_000,
      reconnectMs: 3_000,
      ...opts
    }
  }

  get state(): AtcState {
    return { connected: this.isConnected, request: this.req ? { ...this.req } : null }
  }

  /** Whether BeyondATC's copilot is reading ATC back, when it has said so. */
  get autoRespond(): boolean | null {
    return this.auto
  }

  get enabled(): boolean {
    return this.wanted
  }

  /** The link only connects while it is wanted, so nothing is contacted unless the mode is on. */
  enable(on: boolean): void {
    if (on === this.wanted) return
    this.wanted = on
    if (on) this.connect()
    else this.disconnect()
  }

  /** Ask for `altFt`. The answer shows up in `state.request`. */
  request(altFt: number): void {
    this.dropFlight()
    if (!this.isConnected) {
      this.req = { altFt, status: 'unavailable', note: 'BeyondATC is not connected' }
      return
    }
    this.req = { altFt, status: 'asking', note: 'asking BeyondATC' }
    this.flight = { altFt, stage: 'offer', timer: null }
    this.arm('offer', this.opts.menuWaitMs)
    this.advance()
  }

  /** Abandon whatever is in progress, and cancel the request in BeyondATC if it is still open. */
  cancel(): void {
    if (this.flight?.stage === 'levels' || this.flight?.stage === 'grant') this.closeMenu()
    this.dropFlight()
    this.req = null
  }

  // ---- connection handling ---------------------------------------------------------------

  private connect(): void {
    if (!this.wanted || this.socket) return
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(this.opts.url)
    } catch (err) {
      this.opts.log('warn', `BeyondATC: could not open ${this.opts.url} (${err instanceof Error ? err.message : String(err)})`)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.isConnected = true
      this.warnedDown = false
      this.actions = null
      this.opts.log('info', 'Connected to BeyondATC')
    }
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return
      this.onFrame(typeof ev.data === 'string' ? ev.data : String(ev.data))
    }
    socket.onclose = () => this.onClosed(socket)
    socket.onerror = () => {
      // a close event follows
    }
  }

  private onClosed(socket: SocketLike): void {
    if (this.socket !== socket) return
    this.socket = null
    const wasConnected = this.isConnected
    this.isConnected = false
    this.actions = null
    if (this.flight) this.finish('unavailable', 'lost the connection to BeyondATC')
    if (wasConnected) {
      this.opts.log('warn', 'Lost the connection to BeyondATC')
    } else if (!this.warnedDown) {
      this.warnedDown = true
      this.opts.log('warn', `BeyondATC is not reachable at ${this.opts.url} - is it running? Trying again every ${Math.round(this.opts.reconnectMs / 1000)} s`)
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.opts.reconnectMs)
    this.reconnectTimer.unref?.()
  }

  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.dropFlight()
    const socket = this.socket
    this.socket = null
    this.isConnected = false
    this.actions = null
    this.req = null
    this.warnedDown = false
    try {
      socket?.close()
    } catch {
      // already closed
    }
  }

  // ---- messages --------------------------------------------------------------------------

  private onFrame(frame: string): void {
    let msg: AtcMessage | null
    try {
      msg = parseMessage(frame)
    } catch {
      return
    }
    if (!msg) return
    // While a request is open, say what BeyondATC sent: if a request fails, the log shows why.
    if (this.flight && frame.trim() !== '') this.opts.log('info', `BeyondATC sent: ${frame.length > 300 ? `${frame.slice(0, 300)}...` : frame}`)
    if (msg.kind === 'actions') {
      this.actions = msg.items
      this.advance()
    } else if (msg.kind === 'autoRespond') {
      this.auto = msg.value
    } else if (msg.kind === 'log') {
      this.onLog(msg.source, msg.text)
    }
  }

  private onLog(source: AtcSource, text: string): void {
    const f = this.flight
    if (!f || f.stage !== 'grant') return
    if (source !== 'atc' && source !== 'cpdlcAtc') return
    const verdict = judgeReply(text, f.altFt)
    if (verdict === 'granted') this.finish('granted', text)
    else if (verdict === 'refused') this.finish('refused', text)
  }

  // ---- the request -----------------------------------------------------------------------

  private advance(): void {
    const f = this.flight
    if (!f) return
    if (f.stage === 'offer') {
      const item = this.actions?.find((a) => REQUEST_ALTITUDE.test(a))
      if (item === undefined && this.actions !== null) {
        // BeyondATC listed what is on offer and this is not on the list: wait for it to appear.
        this.setNote('waiting for the request to be on offer')
        return
      }
      // Either it is on the list, or BeyondATC has listed nothing (quiet cruise): ask. A request that is
      // not on offer is ignored by BeyondATC, which shows as the level menu never appearing.
      this.send(`set_action: ${item ?? REQUEST_LABEL}`)
      this.actions = null // that list, if there was one, is out of date: the level menu is the next one
      f.stage = 'levels'
      this.arm('levels', this.opts.levelsWaitMs)
      this.setNote('waiting for the level menu')
      return
    }
    if (f.stage === 'levels') {
      const levels = (this.actions ?? []).filter((a) => labelToFeet(a) !== null)
      if (levels.length === 0) return
      let pick: string | null = null
      let best = Infinity
      for (const label of levels) {
        const diff = Math.abs(labelToFeet(label)! - f.altFt)
        if (diff <= MATCH_FT && diff < best) {
          best = diff
          pick = label
        }
      }
      if (pick === null) {
        this.closeMenu()
        this.finish('refused', `ATC does not offer ${fl(f.altFt)}`)
        return
      }
      this.send(`set_action: ${pick}`)
      this.actions = null // the menu is closed now, so its list is out of date
      f.stage = 'grant'
      this.arm('grant', this.opts.grantWaitMs)
      this.setNote(`asked for ${pick}, waiting for ATC`)
      this.opts.log('info', `BeyondATC: asked for ${pick}`)
    }
  }

  private arm(stage: Stage, ms: number): void {
    const f = this.flight
    if (!f) return
    if (f.timer) clearTimeout(f.timer)
    f.timer = setTimeout(() => {
      if (this.flight !== f || f.stage !== stage) return
      if (stage === 'grant') {
        this.closeMenu() // BeyondATC would otherwise leave the request open
        this.finish('refused', 'no answer from ATC')
      } else {
        if (stage === 'levels') this.closeMenu()
        this.finish('unavailable', stage === 'offer' ? 'the request is not on offer (not in cruise, or ATC is busy)' : 'the level menu did not appear (is a controller tuned, and are you in cruise?)')
      }
    }, ms)
    f.timer.unref?.()
  }

  private setNote(note: string): void {
    if (this.req) this.req = { ...this.req, note }
  }

  private finish(status: 'granted' | 'refused' | 'unavailable', note: string): void {
    this.dropFlight()
    if (this.req) this.req = { ...this.req, status, note }
    this.opts.log(status === 'granted' ? 'info' : 'warn', `BeyondATC: ${status === 'granted' ? 'cleared' : status === 'refused' ? 'not cleared' : 'could not ask'} - ${note}`)
  }

  private dropFlight(): void {
    if (this.flight?.timer) clearTimeout(this.flight.timer)
    this.flight = null
  }

  /**
   * Cancels the request. BeyondATC's controller keeps asking the pilot for the altitude, over and over,
   * until it is cancelled (on the first real flight that went on for hours), so this is sent even when
   * its list of what is on offer was never seen.
   */
  private closeMenu(): void {
    const item = this.actions?.find((a) => CANCEL.test(a)) ?? CANCEL_LABEL
    this.send(`set_action: ${item}`)
    this.actions = null
  }

  private send(text: string): void {
    try {
      this.socket?.send(text)
    } catch (err) {
      this.opts.log('warn', `BeyondATC: could not send (${err instanceof Error ? err.message : String(err)})`)
    }
  }
}
