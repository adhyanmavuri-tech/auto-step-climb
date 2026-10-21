import { distanceNm } from './geo.ts'
import { RouteTracker } from './route-tracker.ts'
import type { RoutePosition } from './route-tracker.ts'
import type { Command, FlightPlan, LatLon, LogEntry, PlannedStep, Snapshot } from './types.ts'

export interface EngineOptions {
  /** Master switch for the auto step climb. */
  enabled: boolean
  /** false = watching only (a "dry run"): the engine decides and logs but never emits a command. */
  live: boolean
  /** Wait for a click on "Confirm" at each step point (use this on VATSIM/IVAO). */
  confirmEachStep: boolean
  /** managed = push the ALT knob, open = pull it. */
  climbMode: 'managed' | 'open'
  /** If push produces no climb, try pull once. */
  fallbackToOpen: boolean
  /** Start the step this many NM before the step fix. */
  leadNm: number
  /** Show "STEP AHEAD" this many NM before the lead point. */
  armWindowNm: number
  /** Still start a step this many NM after its fix; beyond that the step is skipped. */
  lateWindowNm: number
  /** Stop acting when this far from the planned route. */
  maxCrossTrackNm: number
  /** Hold a step while the aircraft is heavier than the OFP planned for that point. */
  weightGuard: boolean
  weightToleranceFrac: number
  maxAltitudeFt: number
  maxStepFt: number
  /** Also fly the OFP's step descents. Off: the aircraft stays at the higher level. */
  stepDowns: boolean
  /** Ask the ATC program (BeyondATC) for each step, and start it only once it is cleared. */
  atcFirst: boolean
  /** Ask this many NM before the step fix, so the clearance is in hand when the aircraft gets there. */
  atcLeadNm: number
  /** Give up waiting for an answer after this long (the ATC link has shorter timeouts of its own). */
  atcTimeoutMs: number
  /** After a refusal or silence, ask once more after this long. */
  atcRetryMs: number
  /**
   * For one run (start with --atc-climb-anyway): when the ATC program can't be reached, or doesn't clear
   * a step after the second try, start the step anyway instead of skipping it. Off by default, because
   * normally a step never starts without a clearance.
   */
  atcClimbAnyway: boolean
  /**
   * Follow an aircraft the app does not control (the host marks its readings "none": it climbs by itself, or you climb
   * it) and ask the ATC program for its steps. Nothing is ever sent to such an aircraft. The host decides whether such
   * an aircraft is followed at all, from the switch in the window; the engine only reports it.
   */
  atcOtherAircraft: boolean
  /**
   * For such an aircraft: ask this many NM before the step fix. An aircraft with an automatic step climb may start it at
   * the step point, so a longer lead gives the answer more time to arrive first (10 NM is about 75 seconds at cruise speed).
   */
  atcOtherLeadNm: number
  /** V/S that counts as "the climb has started". */
  minClimbFpm: number
  climbStartTimeoutMs: number
  fcuTimeoutMs: number
  /** An FCU click that shows no change after this long counts as a miss. */
  clickTimeoutMs: number
  /** Level cruise needed before a step may start. */
  levelStableMs: number
  /** The lowest altitude that counts as cruise. Lower it only to test low down. */
  minCruiseAltFt: number
  /** Level off if the climb stalls below the target. */
  levelOffOnStall: boolean
  stallSeconds: number
  /**
   * False while this aircraft's controls haven't been verified on your sim (the profile's
   * "verified" flag, or a passed Control test). In live mode the engine then holds instead of acting.
   */
  controlReady: boolean
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  enabled: true,
  live: false,
  confirmEachStep: false,
  climbMode: 'managed',
  fallbackToOpen: true,
  leadNm: 0,
  armWindowNm: 15,
  lateWindowNm: 40,
  maxCrossTrackNm: 30,
  weightGuard: true,
  weightToleranceFrac: 0.03,
  maxAltitudeFt: 41_000,
  maxStepFt: 4_000,
  stepDowns: false,
  atcFirst: false,
  atcLeadNm: 10,
  atcTimeoutMs: 120_000,
  atcRetryMs: 120_000,
  atcClimbAnyway: false,
  atcOtherAircraft: false,
  atcOtherLeadNm: 10,
  minClimbFpm: 300,
  climbStartTimeoutMs: 25_000,
  fcuTimeoutMs: 45_000,
  clickTimeoutMs: 1_500,
  levelStableMs: 60_000,
  minCruiseAltFt: 20_000,
  levelOffOnStall: true,
  stallSeconds: 90,
  controlReady: true
}

export type Phase =
  | 'idle'
  | 'waiting'
  | 'armed'
  | 'confirming'
  | 'setting-fcu'
  | 'asking-atc'
  | 'engaging'
  | 'climbing'
  | 'descending'
  | 'restoring'
export type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped' | 'dry-run'

export interface StepState {
  step: PlannedStep
  status: StepStatus
  note: string
  /** Where on the planned route the step is made, NM from the route's start. Null for a step counted in distance flown. */
  atNm?: number | null
}

/** How far along the planned route things are, in NM from its start. */
export interface RouteSpan {
  /** Where the chart starts: the top of climb. */
  fromNm: number
  /** Where the chart ends: the top of descent. */
  toNm: number
  /** The whole route, departure to arrival. */
  totalNm: number
}

export interface EngineStatus {
  phase: Phase
  message: string
  enabled: boolean
  live: boolean
  stepDowns: boolean
  /** The weight check is on: a step is held while the aircraft is heavier than the OFP planned for that point. */
  weightGuard: boolean
  /** The next step is being held back for weight right now (the message says by how much). */
  heldForWeight: boolean
  atcFirst: boolean
  atcClimbAnyway: boolean
  /** The switch for asking the ATC program about aircraft the app does not control. */
  atcOtherAircraft: boolean
  /** The aircraft now loaded is one the app does not control: it only asks the ATC program and sends nothing. */
  askOnly: boolean
  distToNextNm: number | null
  crossTrackNm: number | null
  cruiseNm: number
  /** Distance flown along the planned route, NM from its start. Null with no route, or no reading of the aircraft yet. */
  alongNm: number | null
  /** The planned route in NM (null when the plan has no route, only distance-counted steps). */
  route: RouteSpan | null
  steps: StepState[]
}

/** The part of the route a profile chart covers: top of climb to top of descent, else the whole route. */
export function cruiseSpan(plan: FlightPlan, tracker: RouteTracker): RouteSpan {
  const totalNm = tracker.totalNm
  const fixes = plan.route
  let from = fixes.findIndex((f) => f.ident === 'TOC')
  if (from < 0) from = fixes.findIndex((f) => f.stage === 'CRZ')
  const to = from < 0 ? -1 : fixes.findIndex((f, i) => i > from && (f.ident === 'TOD' || f.stage === 'DSC'))
  const fromNm = from >= 0 ? tracker.fixAlongNm(from) : 0
  const toNm = to > from ? tracker.fixAlongNm(to) : totalNm
  return toNm - fromNm > 1 ? { fromNm, toNm, totalNm } : { fromNm: 0, toNm: totalNm, totalNm }
}

type AfterFcu = 'engage' | 'restore' | 'level-off'

interface KnobState {
  /** Feet per click, learned from the first click that registers. */
  stepFt: number | null
  /** The profile's "up" value turned out to lower the altitude. */
  invert: boolean
  stalls: number
  pending: { before: number; wanted: 1 | -1; t: number } | null
}

const flOf = (ft: number): string => `FL${Math.round(ft / 100)}`

/**
 * The step-climb brain. Pure and synchronous: feed it a Snapshot, get back the commands to send.
 * The sim adapter executes them and the next Snapshot shows the result (closed loop), which keeps
 * the whole thing testable against a simulated aircraft.
 */
export class StepClimbEngine {
  options: EngineOptions
  readonly logs: LogEntry[] = []
  onLog: ((entry: LogEntry) => void) | null = null

  private plan: FlightPlan | null = null
  private tracker: RouteTracker | null = null
  private routeSpan: RouteSpan | null = null
  private steps: StepState[] = []
  private active: StepState | null = null
  private phase: Phase = 'idle'
  private message = 'Starting up'
  private lastT: number | null = null
  /** The newest reading's own time, and the real time the sim has spent paused: the engine's clock leaves that out. */
  private lastRealT: number | null = null
  private pausedMs = 0
  private lastLatLon: LatLon | null = null
  /** The step being flown goes down (set when it begins). */
  private down = false
  private levelSince: number | null = null
  private cruiseNm = 0
  private pos: RoutePosition | null = null
  private distToNext: number | null = null
  private crossTrack: number | null = null
  private confirmed = false
  private forceNext = false
  private heldForWeight = false
  private goalFcuFt = 0
  private afterFcu: AfterFcu = 'engage'
  private prevFcuFt = 0
  private startAltFt = 0
  private phaseStartT = 0
  private engageT = 0
  private climbT0 = 0
  private triedOpen = false
  private slowSince: number | null = null
  private clicks = 0
  /** Sign of the FCU error after the previous click; a flip means a click overshot the goal. */
  private lastErrSign = 0
  private knob: KnobState = { stepFt: null, invert: false, stalls: 0, pending: null }
  // The clearance from the ATC program, for the step it belongs to.
  private atcStepId = ''
  /**
   * 'overridden': ATC did not clear it and "climb anyway" says to go ahead. 'failed': for an aircraft the app does not
   * control, ATC did not clear it after the second try and there is nothing more to ask.
   */
  private atcState: 'idle' | 'asked' | 'granted' | 'retry' | 'overridden' | 'failed' = 'idle'
  /** The loaded aircraft is one the app does not control (its readings say control "none"). */
  private askOnlyAircraft = false
  /** Said once for each such aircraft that the app only asks about its steps. */
  private askOnlyLogged = false
  /** The step whose "ATC is not reachable" has been logged, so it is said once. */
  private atcUnreachableLogged = ''
  private atcAskT = 0
  private atcAttempts = 0
  private atcRetryAt = 0
  private atcGrantedFt: number | null = null
  private atcCancelPending = false

  constructor(options: Partial<EngineOptions> = {}) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options }
  }

  // ---- control surface -------------------------------------------------------------------

  setOptions(patch: Partial<EngineOptions>): void {
    Object.assign(this.options, patch)
  }

  setPlan(plan: FlightPlan | null): void {
    this.plan = plan
    const tracker = plan && plan.route.length >= 2 ? new RouteTracker(plan.route) : null
    this.tracker = tracker
    this.routeSpan = plan && tracker ? cruiseSpan(plan, tracker) : null
    this.pos = null
    this.steps = plan
      ? plan.steps.map((step) => ({
          step,
          status: 'pending' as const,
          note: '',
          atNm: tracker && step.trigger.kind === 'fix' ? tracker.fixAlongNm(step.trigger.fixIndex) : null
        }))
      : []
    this.active = null
    this.cruiseNm = 0
    this.forceNext = false
    this.confirmed = false
    this.heldForWeight = false
    this.dropAtc()
    this.atcGrantedFt = null
    this.setPhase(plan ? 'waiting' : 'idle', plan ? 'Plan loaded' : 'No flight plan loaded')
    if (plan) {
      const list = plan.steps.map((s) => s.label).join(', ') || 'none'
      this.log('info', `Plan loaded (${plan.source}): ${plan.origin || '?'} -> ${plan.destination || '?'}, steps: ${list}`)
    }
  }

  /** Accept the step that is waiting at its step point (confirmEachStep). */
  confirm(): void {
    if (this.phase !== 'confirming') return
    this.confirmed = true
    this.log('info', 'Step confirmed')
  }

  /** Start the next pending step now, ignoring distance, route and weight checks. */
  stepNow(): boolean {
    if (this.askOnlyAircraft) {
      this.log('warn', 'Step now does nothing here: the app does not control this aircraft, it only asks BeyondATC for its steps')
      return false
    }
    if (this.actuating() || !this.steps.some((s) => s.status === 'pending')) return false
    this.forceNext = true
    this.log('info', 'Manual trigger: starting the next step on the next reading')
    return true
  }

  skipNext(): void {
    const next = this.steps.find((s) => s.status === 'pending')
    if (!next) return
    this.finishStep(next, 'skipped', 'skipped by you')
    this.heldForWeight = false
    this.forceNext = false
    this.confirmed = false
    this.dropAtc()
    this.log('warn', `Step ${next.step.label} skipped by you`)
  }

  /** Stop whatever is in progress and send nothing further. The FCU is left as it is. */
  abort(): void {
    if (this.phase === 'asking-atc') {
      const next = this.steps.find((s) => s.status === 'pending')
      if (next) this.finishStep(next, 'skipped', 'stopped by you')
      this.dropAtc()
      this.log('warn', 'Stopped while asking ATC')
      this.setPhase('waiting', 'Stopped - nothing was sent to the aircraft')
      return
    }
    if (!this.actuating()) return
    this.abortActive('stopped by you')
    this.setPhase('waiting', 'Stopped - check the FCU')
  }

  // ---- status ----------------------------------------------------------------------------

  get status(): EngineStatus {
    return {
      phase: this.phase,
      message: this.message,
      enabled: this.options.enabled,
      live: this.options.live,
      stepDowns: this.options.stepDowns,
      weightGuard: this.options.weightGuard,
      heldForWeight: this.heldForWeight,
      atcFirst: this.options.atcFirst,
      atcClimbAnyway: this.options.atcClimbAnyway,
      atcOtherAircraft: this.options.atcOtherAircraft,
      askOnly: this.askOnlyAircraft,
      distToNextNm: this.distToNext,
      crossTrackNm: this.crossTrack,
      cruiseNm: this.cruiseNm,
      alongNm: this.pos ? this.pos.alongNm : null,
      route: this.routeSpan,
      steps: this.steps
    }
  }

  /** The adapter should poll faster while the engine is actively working the FCU. */
  get wantsFastTick(): boolean {
    return this.phase === 'setting-fcu' || this.phase === 'restoring' || this.phase === 'engaging'
  }

  // ---- main loop -------------------------------------------------------------------------

  tick(s: Snapshot | null): Command[] {
    const cmds = this.tickInner(s)
    if (!this.atcCancelPending) return cmds
    // First, so a request made in this same tick is not cancelled by it.
    this.atcCancelPending = false
    return [{ type: 'atc-cancel' }, ...cmds]
  }

  private tickInner(raw: Snapshot | null): Command[] {
    if (!raw) {
      this.dropAtc()
      this.lastLatLon = null
      this.lastRealT = null
      this.askOnlyAircraft = false
      if (this.actuating()) this.abortActive('lost the connection to the sim')
      return this.hold('idle', 'Waiting for the simulator')
    }
    if (!raw.aircraftOk) {
      this.dropAtc()
      this.lastLatLon = null
      this.askOnlyAircraft = false
      if (this.actuating()) this.abortActive('aircraft changed')
      return this.hold('idle', `Unsupported aircraft: ${raw.title || 'none loaded'} (no profile, or its controls are missing - see the log)`)
    }

    // The engine keeps its own clock, which stands still while the sim is paused: a pause must not run out the timers of
    // a step in progress, and nothing is sent into a paused sim.
    const s = this.onOwnClock(raw)
    if (s.simPaused) return this.holdWhilePaused()

    const dt = this.lastT === null ? 0 : Math.min(Math.max((s.t - this.lastT) / 1000, 0), 5)
    this.lastT = s.t
    this.track(s, dt)

    // An aircraft the app does not control is only asked about: nothing below this line can run for it.
    this.askOnlyAircraft = s.control === 'none' && this.options.atcOtherAircraft
    if (!this.askOnlyAircraft) this.askOnlyLogged = false
    if (s.control === 'none') return this.askOnly(s)

    switch (this.phase) {
      case 'setting-fcu':
      case 'restoring':
        return this.driveFcu(s)
      case 'engaging':
        return this.watchEngage(s)
      case 'climbing':
      case 'descending':
        return this.watchClimb(s)
      default:
        return this.evaluate(s)
    }
  }

  /**
   * The reading with the engine's own clock. While the sim is paused the aircraft does not move and nothing it is told is
   * carried out, so the time between those readings is left out: a step is not given up on because someone paused.
   */
  private onOwnClock(raw: Snapshot): Snapshot {
    const gap = this.lastRealT === null ? 0 : Math.max(raw.t - this.lastRealT, 0)
    this.lastRealT = raw.t
    if (raw.simPaused) this.pausedMs += gap
    return this.pausedMs === 0 ? raw : { ...raw, t: raw.t - this.pausedMs }
  }

  /** A paused sim carries out nothing: no command goes into it, and no timer runs. The step carries on when it runs again. */
  private holdWhilePaused(): Command[] {
    this.setPhase(this.phase, this.actuating() ? 'The sim is paused: the step carries on when it runs again' : 'The sim is paused')
    return []
  }

  // ---- bookkeeping -----------------------------------------------------------------------

  private track(s: Snapshot, dt: number): void {
    const level = !s.onGround && s.altFt > this.options.minCruiseAltFt && Math.abs(s.vsFpm) < 250
    if (!this.actuating()) {
      if (level) {
        if (this.levelSince === null) this.levelSince = s.t
        this.cruiseNm += this.flownNm(s, dt)
      } else {
        this.levelSince = null
      }
    }
    this.lastLatLon = { lat: s.lat, lon: s.lon }
    this.pos = this.tracker ? this.tracker.locate(s) : null
  }

  /**
   * Distance flown since the previous reading, from positions rather than speed times clock time.
   * That stays right under time acceleration and while the sim is paused (the clock runs, the
   * aircraft doesn't). A jump no aircraft could fly in that time, even at the sim's top rate of
   * 128x, is a relocation (slew, flight restart) and counts for nothing.
   */
  private flownNm(s: Snapshot, dt: number): number {
    const prev = this.lastLatLon
    if (!prev || dt <= 0) return 0
    const moved = distanceNm(prev, s)
    const limit = (Math.max(s.gsKt, 150) * dt * 130) / 3600 + 1
    return moved <= limit ? moved : 0
  }

  // ---- waiting / arming ------------------------------------------------------------------

  private evaluate(s: Snapshot): Command[] {
    const o = this.options
    this.distToNext = null
    this.crossTrack = null
    if (!o.enabled || !this.plan) this.forceNext = false
    if (!o.enabled) return this.hold('idle', 'Auto step climb is switched off')
    if (!this.plan) return this.hold('idle', 'No flight plan loaded')
    const next = this.steps.find((x) => x.status === 'pending')
    if (!next) return this.hold('idle', 'No steps left in the plan')
    if (o.live && !o.controlReady) {
      return this.hold('waiting', 'Press "Control test" first: the controls for this aircraft have not been verified on your sim yet')
    }

    const step = next.step
    const trig = step.trigger
    let dist: number | null = null
    if (trig.kind === 'fix') {
      if (this.pos && this.tracker) {
        this.crossTrack = this.pos.crossNm
        dist = this.tracker.fixAlongNm(trig.fixIndex) - this.pos.alongNm
      }
    } else {
      dist = trig.afterNm - this.cruiseNm
    }
    this.distToNext = dist

    const forced = this.forceNext
    if (forced) this.dropAtc() // a manual trigger is your own call: no asking ATC
    if (forced) {
      if (s.onGround || s.altFt < Math.min(15_000, o.minCruiseAltFt)) {
        this.forceNext = false
        this.log('warn', 'Manual trigger ignored: the aircraft is not in the cruise')
        return this.hold('waiting', 'Manual trigger ignored: not in the cruise')
      }
    } else {
      if (this.levelSince === null || s.t - this.levelSince < o.levelStableMs) {
        return this.hold('waiting', `Waiting for stable cruise before ${step.label}`)
      }
      if (trig.kind === 'fix') {
        if (dist === null || this.crossTrack === null) {
          return this.hold('waiting', 'Cannot place the aircraft on the planned route')
        }
        if (this.crossTrack > o.maxCrossTrackNm) {
          return this.hold('waiting', `Off the planned route by ${this.crossTrack.toFixed(0)} NM - steps paused`)
        }
      }
      if (dist === null) return this.hold('waiting', 'No distance to the next step')
      if (dist < -o.lateWindowNm && !this.heldForWeight) {
        return this.skip(next, `passed ${Math.abs(dist).toFixed(0)} NM ago`)
      }
      if (dist > o.leadNm + o.armWindowNm) {
        return this.hold('waiting', `${step.label} in ${dist.toFixed(0)} NM`)
      }
    }

    // About to act: check the altitudes themselves.
    const to = step.toAltFt
    const down = to < step.fromAltFt
    if (down && !o.stepDowns && !forced) return this.skip(next, 'step downs are switched off')
    const moveFt = down ? s.altFt - to : to - s.altFt
    if (moveFt <= 400) return this.skip(next, `already at or ${down ? 'below' : 'above'} ${flOf(to)}`)
    if (moveFt > o.maxStepFt) return this.skip(next, `${Math.round(moveFt)} ft is more than the ${o.maxStepFt} ft step limit`)
    if (!down && to > o.maxAltitudeFt) return this.skip(next, `${flOf(to)} is above the ${flOf(o.maxAltitudeFt)} limit`)

    // The weight guard is about whether the aircraft can climb; a heavy aircraft can always descend.
    if (o.weightGuard && !forced && !down && step.plannedWeightKg !== null) {
      const limit = step.plannedWeightKg * (1 + o.weightToleranceFrac)
      if (s.weightKg > limit) {
        this.heldForWeight = true
        const over = (s.weightKg / step.plannedWeightKg - 1) * 100
        return this.hold('waiting', `Holding ${step.label}: ${over.toFixed(1)}% heavier than the OFP planned (skip it or use Step now to override)`)
      }
    }
    this.heldForWeight = false

    // With the ATC program in the loop, nothing starts without its clearance. Watching only sends nothing.
    if (o.atcFirst && o.live && !forced && dist !== null && dist <= Math.max(o.atcLeadNm, o.leadNm)) {
      const held = this.atcGate(s, next)
      if (held) return held
    }

    if (!forced && dist !== null && dist > o.leadNm) {
      const cleared = this.atcState === 'granted' ? ' - cleared by ATC' : ''
      return this.hold('armed', `STEP AHEAD: ${step.label} in ${dist.toFixed(1)} NM${cleared}`)
    }
    if (o.confirmEachStep && !this.confirmed && !forced) {
      return this.hold('confirming', `At the step point for ${step.label} - waiting for your confirmation`)
    }
    return this.begin(s, next)
  }

  /**
   * Gets the ATC program's clearance before a step starts: ask once the aircraft is close enough,
   * wait for the answer, and ask once more after a refusal. Returns what to send or a hold while the
   * step has to wait, and null once it may go ahead. A step never starts without the clearance, unless
   * this run was started with "climb anyway", which goes ahead when ATC can't be reached or doesn't clear it.
   */
  private atcGate(s: Snapshot, st: StepState): Command[] | null {
    const o = this.options
    const step = st.step
    const level = flOf(step.toAltFt)
    if (this.atcStepId !== step.id) {
      this.dropAtc()
      this.atcStepId = step.id
    }
    if (this.atcState === 'granted' || this.atcState === 'overridden') return null

    const atc = s.atc
    if (!atc || !atc.connected) {
      if (o.atcClimbAnyway) {
        if (this.atcUnreachableLogged !== step.id) {
          this.atcUnreachableLogged = step.id
          this.log('warn', `ATC is not connected, so ${step.label} cannot be asked for - climbing anyway, because climb anyway is on`)
        }
        return null // checked again on every reading: if the connection comes back before the step point, it asks
      }
      return this.hold('waiting', `ATC is not connected - ${step.label} will not start without a clearance`)
    }
    const answer = atc.request && atc.request.altFt === step.toAltFt ? atc.request : null

    if (this.atcState === 'idle' || (this.atcState === 'retry' && s.t >= this.atcRetryAt)) {
      this.atcState = 'asked'
      this.atcAskT = s.t
      this.atcAttempts++
      this.log('info', `Asking ATC to clear ${level}${this.atcAttempts > 1 ? ' (second try)' : ''}`)
      this.setPhase('asking-atc', `Asking ATC for ${level}`)
      return [{ type: 'atc-request', altFt: step.toAltFt }]
    }
    if (this.atcState === 'retry') {
      return this.hold('waiting', `ATC did not clear ${level} - asking again in ${Math.ceil((this.atcRetryAt - s.t) / 1000)} s`)
    }

    if (answer?.status === 'granted') {
      this.atcState = 'granted'
      this.atcGrantedFt = step.toAltFt
      this.log('info', `ATC cleared ${level}`)
      return null
    }
    const failed = answer !== null && (answer.status === 'refused' || answer.status === 'unavailable')
    if (failed || s.t - this.atcAskT > o.atcTimeoutMs) {
      const why = answer?.note || 'no answer'
      if (this.atcAttempts < 2) {
        this.atcState = 'retry'
        this.atcRetryAt = s.t + o.atcRetryMs
        this.atcCancelPending = true
        this.log('warn', `ATC did not clear ${level} (${why}) - asking again in ${Math.round(o.atcRetryMs / 1000)} s`)
        return this.hold('waiting', `ATC did not clear ${level} - asking again in ${Math.round(o.atcRetryMs / 1000)} s`)
      }
      if (o.atcClimbAnyway) {
        this.atcState = 'overridden'
        this.atcCancelPending = true // close whatever request is still open before climbing
        this.log('warn', `ATC did not clear ${level} (${why}) - climbing anyway, because climb anyway is on`)
        return null
      }
      return this.skip(st, `ATC did not clear ${level} (${why})`)
    }
    return this.hold('asking-atc', `Waiting for ATC to clear ${level}`)
  }

  /** Forget the clearance in progress, and have the ATC program's request closed if one is open. */
  private dropAtc(): void {
    if (this.atcState === 'asked') this.atcCancelPending = true
    this.atcState = 'idle'
    this.atcAttempts = 0
    this.atcRetryAt = 0
  }

  /** ATC was told a new level that the aircraft didn't reach. */
  private warnIfCleared(st: StepState, s: Snapshot): void {
    if (this.atcGrantedFt !== st.step.toAltFt) return
    this.log('warn', `ATC cleared ${flOf(st.step.toAltFt)} but the step did not complete - the aircraft is at ${flOf(s.altFt)}. Tell ATC if you are still on its frequency`)
  }

  // ---- an aircraft the app does not control ----------------------------------------------------

  /**
   * An aircraft that climbs by itself (an automatic step climb) or that you climb yourself. The app follows the plan,
   * asks the ATC program for each step well before its step point, says what ATC answered, and notes the step as done
   * once the aircraft is at the level. It sends nothing to the aircraft: nothing in here can, because it never builds a
   * command for the sim.
   */
  private askOnly(s: Snapshot): Command[] {
    const o = this.options
    // The host only marks an aircraft this way while the switch is on; this keeps it true if the two ever disagree.
    if (!o.atcOtherAircraft) return this.hold('idle', `Unsupported aircraft: ${s.title || 'none loaded'} (asking BeyondATC in other aircraft is switched off)`)
    if (!this.askOnlyLogged) {
      this.askOnlyLogged = true
      this.log('info', 'This aircraft is not controlled by the app: it asks BeyondATC for each step before the step point, says what ATC answers, and sends nothing to the aircraft')
    }
    if (this.actuating()) this.abortActive('aircraft changed')
    this.distToNext = null
    this.crossTrack = null
    this.forceNext = false
    if (!o.enabled) return this.hold('idle', 'Auto step climb is switched off')
    if (!this.plan) return this.hold('idle', 'No flight plan loaded')
    const next = this.steps.find((x) => x.status === 'pending')
    if (!next) return this.hold('idle', 'No steps left in the plan')

    const step = next.step
    const trig = step.trigger
    const to = step.toAltFt
    const level = flOf(to)
    const down = to < step.fromAltFt
    if (this.atcStepId !== step.id) {
      this.dropAtc()
      this.atcStepId = step.id
    }

    let dist: number | null = null
    if (trig.kind === 'fix') {
      if (this.pos && this.tracker) {
        this.crossTrack = this.pos.crossNm
        dist = this.tracker.fixAlongNm(trig.fixIndex) - this.pos.alongNm
      }
    } else {
      dist = trig.afterNm - this.cruiseNm
    }
    this.distToNext = dist

    // The aircraft is at the new level: it got there by itself, or you flew it.
    const moveFt = down ? s.altFt - to : to - s.altFt
    if (moveFt <= 400) {
      if (this.atcState !== 'idle') {
        this.finishStep(next, 'done', `reached ${level}`)
        this.log('info', `Step ${step.label}: the aircraft reached ${level}`)
        this.dropAtc()
        return this.hold('waiting', `${step.label}: the aircraft reached ${level}`)
      }
      return this.skip(next, `already at or ${down ? 'below' : 'above'} ${level}`)
    }

    if (trig.kind === 'fix') {
      if (dist === null || this.crossTrack === null) return this.hold('waiting', 'Cannot place the aircraft on the planned route')
      if (this.crossTrack > o.maxCrossTrackNm) return this.hold('waiting', `Off the planned route by ${this.crossTrack.toFixed(0)} NM - steps paused`)
    }
    if (dist === null) return this.hold('waiting', 'No distance to the next step')
    // A step point well behind is stale, unless the aircraft is on its way to the new level right now.
    const moving = down ? s.vsFpm <= -o.minClimbFpm : s.vsFpm >= o.minClimbFpm
    if (dist < -o.lateWindowNm && !moving) return this.skip(next, `passed ${Math.abs(dist).toFixed(0)} NM ago`)

    // Already asked: say where it stands until the aircraft gets to the level.
    const when = dist > 0.5 ? `in ${dist.toFixed(0)} NM` : 'now'
    if (this.atcState === 'granted') return this.hold('waiting', `Cleared by BeyondATC: ${step.label} ${when}`)
    if (this.atcState === 'failed') return this.hold('waiting', `BeyondATC did not clear ${level}: ${step.label} ${when}`)

    if (this.atcState === 'idle') {
      // Far from the step point, or not yet in the cruise (BeyondATC offers a new level only there): nothing to ask yet.
      if (dist > o.atcOtherLeadNm) return this.hold('waiting', `${step.label} in ${dist.toFixed(0)} NM`)
      if (this.levelSince === null || s.t - this.levelSince < o.levelStableMs) {
        return this.hold('waiting', `Waiting for stable cruise before asking for ${step.label}`)
      }
      if (down && !o.stepDowns) return this.skip(next, 'step downs are switched off')
    }
    return this.askOnlyGate(s, next, level)
  }

  /** Asks the ATC program for the step's new level, once more after a refusal, and says what it answered. */
  private askOnlyGate(s: Snapshot, st: StepState, level: string): Command[] {
    const o = this.options
    const step = st.step
    const atc = s.atc
    if (!atc || !atc.connected) {
      if (this.atcUnreachableLogged === step.id) return this.hold('waiting', `ATC is not connected: ${step.label} cannot be asked for yet`)
      this.atcUnreachableLogged = step.id
      this.log('warn', `ATC is not connected, so ${level} for ${step.label} cannot be asked for (it is tried again on every reading)`)
      this.setPhase('waiting', `ATC is not connected: ${step.label} cannot be asked for yet`)
      return [{ type: 'notify', title: `BeyondATC is not connected`, text: `${step.label}: ${level} cannot be asked for. Is BeyondATC running?` }]
    }
    const answer = atc.request && atc.request.altFt === step.toAltFt ? atc.request : null

    if (this.atcState === 'idle' || (this.atcState === 'retry' && s.t >= this.atcRetryAt)) {
      this.atcState = 'asked'
      this.atcAskT = s.t
      this.atcAttempts++
      this.log('info', `Asking ATC to clear ${level}${this.atcAttempts > 1 ? ' (second try)' : ''}`)
      this.setPhase('asking-atc', `Asking ATC for ${level}`)
      return [{ type: 'atc-request', altFt: step.toAltFt }]
    }
    if (this.atcState === 'retry') {
      return this.hold('waiting', `ATC did not clear ${level} - asking again in ${Math.ceil((this.atcRetryAt - s.t) / 1000)} s`)
    }

    if (answer?.status === 'granted') {
      this.atcState = 'granted'
      this.atcGrantedFt = step.toAltFt
      this.log('info', `ATC cleared ${level}`)
      this.setPhase('waiting', `Cleared by BeyondATC: ${step.label}`)
      return [{ type: 'notify', title: `BeyondATC cleared ${level}`, text: `${step.label}: your aircraft can climb to ${level}.` }]
    }
    const failed = answer !== null && (answer.status === 'refused' || answer.status === 'unavailable')
    if (failed || s.t - this.atcAskT > o.atcTimeoutMs) {
      const why = answer?.note || 'no answer'
      this.atcCancelPending = true // close whatever request is still open
      if (this.atcAttempts < 2) {
        this.atcState = 'retry'
        this.atcRetryAt = s.t + o.atcRetryMs
        this.log('warn', `ATC did not clear ${level} (${why}) - asking again in ${Math.round(o.atcRetryMs / 1000)} s`)
        return this.hold('waiting', `ATC did not clear ${level} - asking again in ${Math.round(o.atcRetryMs / 1000)} s`)
      }
      this.atcState = 'failed'
      this.log('warn', `ATC did not clear ${level} (${why}). Nothing more is asked, and the aircraft is not touched`)
      this.setPhase('waiting', `BeyondATC did not clear ${level}: ${step.label}`)
      return [{ type: 'notify', title: `BeyondATC did not clear ${level}`, text: `${step.label}: ${why}. The app does not touch your aircraft.` }]
    }
    return this.hold('asking-atc', `Waiting for ATC to clear ${level}`)
  }

  private begin(s: Snapshot, st: StepState): Command[] {
    const o = this.options
    this.atcState = 'idle'
    this.atcAttempts = 0
    this.down = st.step.toAltFt < st.step.fromAltFt
    const noun = this.down ? 'descent' : 'climb'
    const mode = o.climbMode === 'managed' ? `start a managed ${noun} (PUSH)` : `start an open ${noun} (PULL)`
    this.forceNext = false
    this.confirmed = false
    this.heldForWeight = false

    if (!o.live) {
      this.finishStep(st, 'dry-run', `would have set ${flOf(st.step.toAltFt)}`)
      this.cruiseNm = 0
      this.log('info', `[watching only] ${st.step.label}: would set the FCU to ${flOf(st.step.toAltFt)} and ${mode}. Nothing was sent to the sim: turn on Live control to let the app do it.`)
      return this.hold('waiting', `Watching only: ${st.step.label} would have started`)
    }

    st.status = 'active'
    this.active = st
    this.prevFcuFt = s.fcuSelectedFt
    this.startAltFt = s.altFt
    this.triedOpen = false
    this.log('info', `Step ${st.step.label}: setting the FCU to ${flOf(st.step.toAltFt)}, then ${mode}`)
    this.startFcu(s, st.step.toAltFt, 'engage')
    return this.driveFcu(s)
  }

  private skip(st: StepState, reason: string): Command[] {
    this.finishStep(st, 'skipped', reason)
    this.heldForWeight = false
    this.dropAtc()
    this.log('warn', `Step ${st.step.label} skipped: ${reason}`)
    return this.hold('waiting', `Skipped ${st.step.label}: ${reason}`)
  }

  // ---- closed-loop FCU altitude ----------------------------------------------------------

  private startFcu(s: Snapshot, goal: number, then: AfterFcu): void {
    this.goalFcuFt = goal
    this.afterFcu = then
    this.phaseStartT = s.t
    this.clicks = 0
    this.lastErrSign = 0
    this.knob.pending = null
    this.knob.stalls = 0
    const label = then === 'engage' ? `Setting the FCU to ${flOf(goal)}` : then === 'restore' ? `Restoring the FCU to ${flOf(goal)}` : `Levelling off at ${flOf(goal)}`
    this.setPhase(then === 'engage' ? 'setting-fcu' : 'restoring', label)
  }

  /**
   * Gets the FCU altitude to the goal and checks every command against the next reading. A knob
   * moves one click per reading; a direct-style aircraft is told the altitude in one command.
   */
  private driveFcu(s: Snapshot): Command[] {
    const o = this.options
    const k = this.knob
    const direct = s.control === 'direct'
    if (s.t - this.phaseStartT > o.fcuTimeoutMs) return this.fcuFailed(s, 'The FCU did not reach the target in time')

    if (k.pending) {
      const moved = s.fcuSelectedFt - k.pending.before
      if (Math.abs(moved) >= 1) {
        if (direct) {
          if (moved * k.pending.wanted < 0) return this.fcuFailed(s, 'The altitude moved the wrong way after the set-altitude command')
        } else if (k.stepFt === null) {
          k.stepFt = Math.abs(moved)
          if (moved * k.pending.wanted < 0) {
            k.invert = !k.invert
            this.log('warn', 'The FCU knob turns the opposite way to the profile - compensating')
          }
          this.log('info', `FCU knob: one click = ${k.stepFt} ft`)
        }
        k.pending = null
        k.stalls = 0
      } else if (s.t - k.pending.t >= o.clickTimeoutMs) {
        k.pending = null
        k.stalls++
        if (k.stalls >= 3) {
          return this.fcuFailed(s, direct ? 'The FCU did not respond to 3 set-altitude commands' : 'The FCU knob did not respond to 3 clicks')
        }
      } else {
        return []
      }
    }

    const err = this.goalFcuFt - s.fcuSelectedFt
    const tolerance = direct ? 50 : Math.max(1, Math.min(k.stepFt ?? 100, 100) / 2)
    if (Math.abs(err) < tolerance) return this.fcuReached(s)
    if (this.clicks >= 150) return this.fcuFailed(s, 'Too many FCU commands')

    // A click that jumps over the goal means the knob's step doesn't divide the distance (the FCU
    // ring is on 1000 ft and the goal isn't a multiple of 1000). Stop instead of hunting back and forth.
    const sign = Math.sign(err)
    if (!direct && k.stepFt !== null && this.lastErrSign !== 0 && sign !== this.lastErrSign) {
      return this.fcuFailed(s, `One click moves the FCU ${k.stepFt} ft, so it can't land on ${flOf(this.goalFcuFt)} - set the FCU ring to 100 ft`)
    }
    this.lastErrSign = sign

    const wanted: 1 | -1 = err > 0 ? 1 : -1
    k.pending = { before: s.fcuSelectedFt, wanted, t: s.t }
    this.clicks++
    if (direct) return [{ type: 'set-altitude', ft: this.goalFcuFt }]
    return [{ type: 'fcu-click', dir: k.invert ? (-wanted as 1 | -1) : wanted }]
  }

  private fcuReached(s: Snapshot): Command[] {
    if (this.afterFcu === 'engage') {
      const mode = this.options.climbMode
      const noun = this.down ? 'descent' : 'climb'
      const what = mode === 'managed' ? `a managed ${noun} (PUSH)` : `an open ${noun} (PULL)`
      this.setPhase('engaging', `FCU at ${flOf(this.goalFcuFt)} - starting ${what}`)
      this.engageT = s.t
      this.startAltFt = s.altFt
      this.log('info', `FCU at ${flOf(this.goalFcuFt)}; starting ${what}`)
      return [{ type: 'engage', mode }]
    }
    if (this.afterFcu === 'restore') {
      this.log('info', `FCU restored to ${flOf(this.goalFcuFt)}`)
    } else {
      this.log('warn', `Levelled off with the FCU at ${flOf(this.goalFcuFt)}`)
    }
    this.closeActive(s)
    return []
  }

  private fcuFailed(s: Snapshot, reason: string): Command[] {
    if (this.afterFcu === 'engage') return this.stepFailed(s, reason)
    this.log('error', `${reason} - check the FCU yourself`)
    this.closeActive(s)
    return []
  }

  // ---- engage / climb --------------------------------------------------------------------

  private watchEngage(s: Snapshot): Command[] {
    const o = this.options
    const noun = this.down ? 'descent' : 'climb'
    const started = this.down
      ? s.vsFpm <= -o.minClimbFpm && s.altFt < this.startAltFt - 40
      : s.vsFpm >= o.minClimbFpm && s.altFt > this.startAltFt + 40
    if (started) {
      this.setPhase(this.down ? 'descending' : 'climbing', `${this.down ? 'Descending' : 'Climbing'} to ${flOf(this.goalFcuFt)}`)
      this.climbT0 = s.t
      this.slowSince = null
      this.log('info', `${this.down ? 'Descent' : 'Climb'} started (${Math.round(s.vsFpm)} fpm)`)
      return []
    }
    if (s.t - this.engageT > o.climbStartTimeoutMs) {
      if (o.climbMode === 'managed' && o.fallbackToOpen && !this.triedOpen) {
        this.triedOpen = true
        this.engageT = s.t
        this.log('warn', `No ${noun} after the managed ${noun} (PUSH) - trying an open ${noun} (PULL)`)
        this.setPhase('engaging', `No ${noun} yet - trying an open ${noun} (PULL)`)
        return [{ type: 'engage', mode: 'open' }]
      }
      return this.stepFailed(s, `No ${noun} after the ${noun} command (is the autopilot on?)`)
    }
    return []
  }

  private watchClimb(s: Snapshot): Command[] {
    const o = this.options
    const st = this.active
    if (!st) {
      this.setPhase('waiting', 'Waiting for the next step')
      return []
    }
    const target = st.step.toAltFt
    const noun = this.down ? 'descent' : 'climb'

    if (Math.abs(s.altFt - target) <= 150 && Math.abs(s.vsFpm) < 300) {
      this.finishStep(st, 'done', `reached ${flOf(target)}`)
      this.log('info', `Step ${st.step.label} complete at ${flOf(s.altFt)}`)
      this.closeActive(s)
      return []
    }

    const behind = this.down ? s.vsFpm > -100 && s.altFt > target + 300 : s.vsFpm < 100 && s.altFt < target - 300
    if (behind) {
      if (this.slowSince === null) this.slowSince = s.t
    } else {
      this.slowSince = null
    }
    if (this.slowSince !== null && s.t - this.slowSince > o.stallSeconds * 1000) {
      this.finishStep(st, 'failed', `${noun} stalled at ${flOf(s.altFt)}`)
      this.log('error', `Step ${st.step.label}: ${noun} stalled at ${flOf(s.altFt)}`)
      this.warnIfCleared(st, s)
      if (o.levelOffOnStall) {
        // Hold the level it is at: round toward where it was heading.
        const hold = this.down ? Math.floor(s.altFt / 100) * 100 : Math.ceil(s.altFt / 100) * 100
        this.startFcu(s, hold, 'level-off')
        return this.driveFcu(s)
      }
      this.closeActive(s)
      return []
    }

    if (s.t - this.climbT0 > 40 * 60_000) {
      this.finishStep(st, 'failed', `the ${noun} took more than 40 minutes`)
      this.log('error', `Step ${st.step.label}: the ${noun} took more than 40 minutes`)
      this.closeActive(s)
    }
    return []
  }

  private stepFailed(s: Snapshot, reason: string): Command[] {
    const o = this.options
    const st = this.active
    if (st) {
      this.finishStep(st, 'failed', reason)
      this.log('error', `Step ${st.step.label} failed: ${reason}`)
      this.warnIfCleared(st, s)
    }
    const leftLevel = this.down
      ? s.altFt < this.startAltFt - 100 || s.vsFpm <= -o.minClimbFpm
      : s.altFt > this.startAltFt + 100 || s.vsFpm >= o.minClimbFpm
    if (!leftLevel && Math.abs(s.fcuSelectedFt - this.prevFcuFt) > 1) {
      this.startFcu(s, this.prevFcuFt, 'restore')
      return this.driveFcu(s)
    }
    this.closeActive(s)
    return []
  }

  // ---- helpers ---------------------------------------------------------------------------

  /** True while the engine is working the FCU or flying a step (not while it is only asking ATC). */
  actuating(): boolean {
    return (
      this.phase === 'setting-fcu' ||
      this.phase === 'engaging' ||
      this.phase === 'climbing' ||
      this.phase === 'descending' ||
      this.phase === 'restoring'
    )
  }

  private closeActive(s: Snapshot): void {
    this.active = null
    this.levelSince = s.t
    this.cruiseNm = 0
    this.setPhase('waiting', 'Waiting for the next step')
  }

  private abortActive(reason: string): void {
    if (this.active) {
      this.finishStep(this.active, 'failed', reason)
      this.log('error', `Step ${this.active.step.label} aborted: ${reason}`)
    }
    this.active = null
  }

  private finishStep(st: StepState, status: StepStatus, note: string): void {
    st.status = status
    st.note = note
  }

  private hold(phase: Phase, message: string): Command[] {
    this.setPhase(phase, message)
    return []
  }

  private setPhase(phase: Phase, message: string): void {
    this.phase = phase
    this.message = message
  }

  private log(level: LogEntry['level'], text: string): void {
    const entry: LogEntry = { at: Date.now(), level, text }
    this.logs.push(entry)
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300)
    this.onLog?.(entry)
  }
}
