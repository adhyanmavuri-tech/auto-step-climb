import { StepClimbEngine } from '../src/engine.ts'
import type { EngineOptions } from '../src/engine.ts'
import { FakeAircraft } from '../src/fake-sim.ts'
import { RouteTracker } from '../src/route-tracker.ts'
import type { Command, FlightPlan, RouteFix } from '../src/types.ts'

/** Five fixes along the equator, 5 degrees (about 300 NM) apart. FIX2 is where the plan steps up. */
export function makeRoute(): RouteFix[] {
  const alts = [34000, 34000, 36000, 36000, 36000]
  return [0, 5, 10, 15, 20].map((lon, i) => ({
    ident: `FIX${i}`,
    lat: 0,
    lon,
    altitudeFt: alts[i]!,
    stage: 'CRZ',
    plannedWeightKg: 190_000 - i * 3_000
  }))
}

export function makePlan(): FlightPlan {
  const route = makeRoute()
  const fix = route[2]!
  return {
    source: 'simbrief',
    origin: 'AAAA',
    destination: 'BBBB',
    generatedAt: null,
    initialAltFt: 34000,
    route,
    steps: [
      {
        id: 'step-1',
        label: 'FIX2 FL360',
        fromAltFt: 34000,
        toAltFt: 36000,
        trigger: { kind: 'fix', fixIdent: fix.ident, fixIndex: 2, lat: fix.lat, lon: fix.lon },
        plannedWeightKg: fix.plannedWeightKg
      }
    ]
  }
}

/** The standard plan with these steps instead: [fix index, from ft, to ft] each, at that fix. */
export function makeStepPlan(steps: [number, number, number][]): FlightPlan {
  const plan = makePlan()
  plan.steps = steps.map(([i, from, to], k) => {
    const f = plan.route[i]!
    return {
      id: `step-${k + 1}`,
      label: `${f.ident} FL${Math.round(to / 100)}`,
      fromAltFt: from,
      toAltFt: to,
      trigger: { kind: 'fix' as const, fixIdent: f.ident, fixIndex: i, lat: f.lat, lon: f.lon },
      plannedWeightKg: f.plannedWeightKg
    }
  })
  return plan
}

/** A small OFP in SimBrief's JSON shape: a climb to FL340, then one step to FL360 at fix A (one fix before B shows it). */
export function smallOfp(origin = 'AAAA', destination = 'BBBB', generated = '1760000000'): Record<string, unknown> {
  const fixes: [string, number, number, string, number][] = [
    ['AAAA', 0, 0, 'CLB', 120_000],
    ['TOC', 0.5, 34000, 'CLB', 110_000],
    ['A', 1.5, 34000, 'CRZ', 100_000],
    ['B', 2.5, 36000, 'CRZ', 90_000],
    ['TOD', 3.5, 36000, 'CRZ', 60_000],
    ['BBBB', 4, 0, 'DSC', 20_000]
  ]
  return {
    fetch: { status: 'Success' },
    params: { units: 'kgs', time_generated: generated },
    general: { initial_altitude: '34000' },
    weights: { est_zfw: '100000' },
    origin: { icao_code: origin },
    destination: { icao_code: destination },
    navlog: {
      fix: fixes.map(([ident, lon, alt, stage, onboard]) => ({
        ident,
        pos_lat: '0',
        pos_long: String(lon),
        altitude_feet: String(alt),
        stage,
        fuel_plan_onboard: String(onboard)
      }))
    }
  }
}

export const STEP_ALONG_NM = new RouteTracker(makeRoute()).fixAlongNm(2)

export function makeAircraft(startAlongNm = 500, altFt = 34000): FakeAircraft {
  return new FakeAircraft({ route: makeRoute(), startAlongNm, altFt })
}

export function makeEngine(options: Partial<EngineOptions> = {}, plan: FlightPlan | null = makePlan()): StepClimbEngine {
  const engine = new StepClimbEngine({ live: true, ...options })
  engine.setPlan(plan)
  return engine
}

export interface Sent {
  t: number
  alongNm: number
  cmd: Command
}

/** Drive engine and aircraft together for `seconds` of simulated time. */
export function run(
  engine: StepClimbEngine,
  ac: FakeAircraft,
  seconds: number,
  onTick?: (ac: FakeAircraft) => void,
  tickMs = 1000
): Sent[] {
  const sent: Sent[] = []
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += tickMs) {
    for (const cmd of engine.tick(ac.snapshot())) {
      ac.execute(cmd)
      sent.push({ t: ac.t, alongNm: ac.alongNm, cmd })
    }
    onTick?.(ac)
    ac.advance(tickMs)
  }
  return sent
}

export const clicksOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'fcu-click')
export const engagesOf = (sent: Sent[]): Command[] => sent.filter((s) => s.cmd.type === 'engage').map((s) => s.cmd)
export const setsOf = (sent: Sent[]): Command[] => sent.filter((s) => s.cmd.type === 'set-altitude').map((s) => s.cmd)
