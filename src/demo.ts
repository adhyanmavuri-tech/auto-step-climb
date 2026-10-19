import type { EngineOptions } from './engine.ts'
import { FakeAircraft } from './fake-sim.ts'
import { detectSteps } from './plan.ts'
import { RouteTracker } from './route-tracker.ts'
import type { SimAdapter } from './sim.ts'
import type { FlightPlan, RouteFix, SimCommand, Snapshot } from './types.ts'

/** The demo runs this many times faster than real time, so the engine settings are relaxed to match. */
const SPEED = 60
const TICK_REAL_MS = 250

/** What the sped-up clock needs. Used by the demo and by the preview of a real flight plan. */
export const DEMO_TIMING: Partial<EngineOptions> = {
  live: true, // safe: commands only ever reach the simulated aircraft
  // The pretend BeyondATC answers in real seconds while the demo clock runs 60x, so its waits are scaled up too.
  atcLeadNm: 40,
  atcOtherLeadNm: 40, // likewise for an aircraft the app does not control (the real default is shorter)
  atcTimeoutMs: 900_000,
  atcRetryMs: 300_000,
  levelStableMs: 20_000,
  fcuTimeoutMs: 900_000,
  climbStartTimeoutMs: 120_000,
  stallSeconds: 300
}

export const DEMO_ENGINE_OPTIONS: Partial<EngineOptions> = {
  ...DEMO_TIMING,
  stepDowns: true, // the demo flies its step down; switch it off on the dashboard to see it skipped
  atcFirst: true // a pretend BeyondATC clears each step first; switch it off on the dashboard to skip that
}

const DEMO_FIXES: [string, number, number, number, string][] = [
  ['TOC', 52.0, -8, 34000, 'CLB'],
  ['ALPHA', 52.5, -14, 34000, 'CRZ'],
  ['BRAVO', 53.0, -20, 34000, 'CRZ'],
  ['CHARL', 53.5, -26, 36000, 'CRZ'],
  ['DELTA', 53.5, -32, 36000, 'CRZ'],
  ['ECHO', 53.0, -38, 38000, 'CRZ'],
  ['FOXTR', 52.5, -44, 36000, 'CRZ'], // a step down, to show the step-downs switch
  ['TOD', 52.0, -50, 36000, 'CRZ'],
  ['LAND', 51.0, -56, 0, 'DSC']
]

export function makeDemoPlan(): FlightPlan {
  const route: RouteFix[] = DEMO_FIXES.map(([ident, lat, lon, altitudeFt, stage], i) => ({
    ident,
    lat,
    lon,
    altitudeFt,
    stage,
    plannedWeightKg: 190_000 - i * 4_000
  }))
  return {
    source: 'demo',
    origin: 'DEMO',
    destination: 'TEST',
    generatedAt: null,
    initialAltFt: 34000,
    route,
    steps: detectSteps(route, 34000)
  }
}

/** The levels a plan climbs and descends between, written the way BeyondATC's menu writes them. */
export function planLevelLabels(plan: FlightPlan): string[] {
  const levels = new Set<number>([plan.initialAltFt])
  for (const s of plan.steps) {
    levels.add(s.fromAltFt)
    levels.add(s.toAltFt)
  }
  return [...levels]
    .filter((ft) => ft > 0)
    .sort((a, b) => a - b)
    .map((ft) => `FL${Math.round(ft / 100)}`)
}

/** The weight the plan has the aircraft at this far along the route, or null where the plan has none. */
function plannedWeightAt(route: RouteFix[], along: number[], nm: number): number | null {
  for (let i = 1; i < route.length; i++) {
    if (nm <= along[i]!) {
      const a = route[i - 1]!.plannedWeightKg
      const b = route[i]!.plannedWeightKg
      if (a === null || b === null) return null
      const span = along[i]! - along[i - 1]!
      return a + (b - a) * (span > 0 ? (nm - along[i - 1]!) / span : 0)
    }
  }
  return route[route.length - 1]!.plannedWeightKg
}

/**
 * A simulated aircraft flying a plan, sped up. Never touches Microsoft Flight Simulator. In the demo it
 * flies a made-up route. In a preview it flies a real flight plan from the first cruise fix, with the
 * weight the plan expects at each point, so the dashboard shows what the real flight would do.
 */
export class DemoAdapter implements SimAdapter {
  readonly kind = 'demo'
  readonly connected = true
  readonly profile: { name: string; verified: boolean; control: 'knob' } | null
  lastDataAt = 0
  readonly aircraft: FakeAircraft
  private timer: NodeJS.Timeout | null = null
  /** Set in a preview: the plan's route and each fix's distance along it, for the weight to follow. */
  private readonly followRoute: RouteFix[] | null
  private readonly followAlong: number[] = []
  /** For "other aircraft": where each step is, so the simulated aircraft can climb by itself there, as an automatic step climb does. */
  private readonly selfSteps: { atNm: number; toAltFt: number; started: boolean }[] = []

  /**
   * `unsupported` is for the tests: the simulated aircraft is one the app has no profile for. `otherAircraft` is the same,
   * for showing the BeyondATC-only mode: the aircraft has no profile and climbs by itself at each step point.
   */
  constructor(plan: FlightPlan, opts: { preview?: boolean; unsupported?: boolean; otherAircraft?: boolean } = {}) {
    const usable = plan.route.length >= 2
    const preview = opts.preview === true && usable
    let startAlongNm = 120
    let altFt = 34000
    let weightKg = 188_000
    this.followRoute = null
    if (preview) {
      const tracker = new RouteTracker(plan.route)
      this.followRoute = plan.route
      this.followAlong = plan.route.map((_, i) => tracker.fixAlongNm(i))
      const toc = Math.max(0, plan.route.findIndex((f) => f.stage === 'CRZ'))
      startAlongNm = this.followAlong[toc]! + 5
      altFt = plan.initialAltFt > 0 ? plan.initialAltFt : plan.route[toc]!.altitudeFt
      weightKg = plan.route[toc]!.plannedWeightKg ?? weightKg
    }
    this.aircraft = new FakeAircraft({
      route: (usable ? plan : makeDemoPlan()).route,
      startAlongNm,
      altFt,
      gsKt: 480,
      weightKg
    })
    this.aircraft.title = preview ? 'A330 (PREVIEW)' : 'A330-300 (DEMO)'
    this.aircraft.climbRateFpm = 1800
    this.profile = opts.unsupported || opts.otherAircraft ? null : { name: preview ? 'Preview aircraft' : 'Demo aircraft', verified: true, control: 'knob' }
    if (opts.unsupported) {
      this.aircraft.title = 'A320 (DEMO)'
      this.aircraft.aircraftOk = false
    }
    if (opts.otherAircraft) {
      this.aircraft.title = preview ? 'Other aircraft (PREVIEW)' : 'Other aircraft (DEMO)'
      this.aircraft.aircraftOk = false // as for any aircraft the app has no profile for; the core follows it when asked to
      const route = (usable ? plan : makeDemoPlan()).route
      const tracker = new RouteTracker(route)
      for (const step of (usable ? plan : makeDemoPlan()).steps) {
        // An aircraft's own automatic step climb goes up; nothing steps down by itself. A preview starts just after the
        // first cruise fix, so a step there is made a little way on (the pretend BeyondATC answers in real seconds, which
        // are many miles at this speed), which leaves the app time to ask, and to hear the answer, before it happens.
        if (step.trigger.kind === 'fix' && step.toAltFt > step.fromAltFt) {
          this.selfSteps.push({ atNm: Math.max(tracker.fixAlongNm(step.trigger.fixIndex), startAlongNm + 30), toAltFt: step.toAltFt, started: false })
        }
      }
    }
  }

  start(onSnapshot: (s: Snapshot | null) => void): void {
    this.timer = setInterval(() => {
      const simMs = TICK_REAL_MS * SPEED
      for (const step of this.selfSteps) {
        if (!step.started && this.aircraft.alongNm >= step.atNm) {
          step.started = true
          this.aircraft.fcuSelectedFt = step.toAltFt // the aircraft sets its own level and climbs to it
          this.aircraft.execute({ type: 'engage', mode: 'managed' })
        }
      }
      this.aircraft.advance(simMs)
      if (this.followRoute) {
        this.aircraft.weightKg = plannedWeightAt(this.followRoute, this.followAlong, this.aircraft.alongNm) ?? this.aircraft.weightKg
      } else {
        this.aircraft.weightKg -= (5_500 * simMs) / 3_600_000 // roughly the fuel burn of an A330
      }
      this.lastDataAt = Date.now()
      onSnapshot(this.aircraft.snapshot())
    }, TICK_REAL_MS)
  }

  execute(cmd: SimCommand): void {
    this.aircraft.execute(cmd)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
