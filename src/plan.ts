import type { FlightPlan, PlannedStep, RouteFix } from './types.ts'

const LB_TO_KG = 0.45359237

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** SimBrief's JSON turns a one-element list into a bare object, so normalise. */
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v])

/** What SimBrief calls the flight: its ATC callsign (ALK607), else the airline and the number put together. */
export function flightName(ofp: Record<string, unknown>): string {
  const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
  const atc = isRecord(ofp.atc) ? ofp.atc : {}
  const general = isRecord(ofp.general) ? ofp.general : {}
  const name = text(atc.callsign) || `${text(general.icao_airline)}${text(general.flight_number)}`
  return name.slice(0, 16)
}

export interface ParseOptions {
  /**
   * Where a step starts. 'previous-fix' (the default) = at the fix before the first one that shows
   * the higher altitude. SimBrief's navlog shows the new level one fix after the step point, and its
   * own step list (general.stepclimb_string) names that earlier fix. 'fix' = at the first fix that
   * shows the higher level, one fix later.
   */
  stepAt?: 'fix' | 'previous-fix'
  /** Smallest altitude change that counts as a step, feet. */
  minStepFt?: number
}

/**
 * Turns a SimBrief OFP (xml.fetcher.php?json=1) into a plan. SimBrief delivers every number as a
 * string, so everything goes through num().
 */
export function parseSimbriefOfp(ofp: unknown, opts: ParseOptions = {}): FlightPlan {
  if (!isRecord(ofp)) throw new Error('SimBrief response is not a JSON object')
  const status = isRecord(ofp.fetch) ? ofp.fetch.status : undefined
  if (typeof status === 'string' && status !== 'Success') throw new Error(`SimBrief: ${status}`)

  const rawFixes = isRecord(ofp.navlog) ? asArray(ofp.navlog.fix) : []
  if (rawFixes.length === 0) {
    throw new Error('The OFP has no navlog fixes - generate it in SimBrief with the detailed navlog enabled')
  }

  const params = isRecord(ofp.params) ? ofp.params : {}
  const weights = isRecord(ofp.weights) ? ofp.weights : {}
  const fuel = isRecord(ofp.fuel) ? ofp.fuel : {}
  const general = isRecord(ofp.general) ? ofp.general : {}
  const toKg = String(params.units ?? '').toLowerCase().startsWith('lb') ? LB_TO_KG : 1
  const zfw = num(weights.est_zfw)
  const planRamp = num(fuel.plan_ramp)

  const route: RouteFix[] = []
  for (const raw of rawFixes) {
    if (!isRecord(raw)) continue
    const lat = num(raw.pos_lat)
    const lon = num(raw.pos_long)
    const altitudeFt = num(raw.altitude_feet)
    if (lat === null || lon === null || altitudeFt === null) continue
    const used = num(raw.fuel_totalused)
    const onboard = num(raw.fuel_plan_onboard) ?? (planRamp !== null && used !== null ? planRamp - used : null)
    route.push({
      ident: String(raw.ident ?? '?'),
      lat,
      lon,
      altitudeFt,
      stage: String(raw.stage ?? '').toUpperCase(),
      plannedWeightKg: zfw !== null && onboard !== null ? (zfw + onboard) * toKg : null
    })
  }
  if (route.length < 2) throw new Error('The OFP navlog has fewer than two usable fixes')

  const firstCruise = route.find((f) => f.stage === 'CRZ')
  const initialAltFt = num(general.initial_altitude) ?? firstCruise?.altitudeFt ?? 0
  const generated = num(params.time_generated)

  return {
    source: 'simbrief',
    origin: String(isRecord(ofp.origin) ? (ofp.origin.icao_code ?? '') : ''),
    destination: String(isRecord(ofp.destination) ? (ofp.destination.icao_code ?? '') : ''),
    flight: flightName(ofp),
    generatedAt: generated !== null ? new Date(generated * 1000).toISOString() : null,
    initialAltFt,
    route,
    steps: detectSteps(route, initialAltFt, opts)
  }
}

/**
 * Steps are altitude changes, climbs and descents, between consecutive fixes once the route has
 * reached its initial cruise level. Works from altitudes alone, so it doesn't depend on how SimBrief
 * labels the stage of the step fix. Whether the descents are flown is the engine's stepDowns option.
 */
export function detectSteps(route: RouteFix[], initialAltFt: number, opts: ParseOptions = {}): PlannedStep[] {
  const minStepFt = opts.minStepFt ?? 900
  const stepAt = opts.stepAt ?? 'previous-fix'
  const steps: PlannedStep[] = []

  let cruising = false
  let level = initialAltFt
  for (let i = 0; i < route.length; i++) {
    const fix = route[i]!
    if (!cruising) {
      if (initialAltFt > 0 && fix.altitudeFt >= initialAltFt - 100 && fix.stage !== 'DSC') {
        cruising = true
        level = fix.altitudeFt
      }
      continue
    }
    if (fix.stage === 'DSC' || fix.ident === 'TOD') break
    if (Math.abs(fix.altitudeFt - level) >= minStepFt) {
      const at = stepAt === 'previous-fix' && i > 0 ? i - 1 : i
      const where = route[at]!
      steps.push({
        id: `step-${steps.length + 1}`,
        label: `${where.ident} FL${Math.round(fix.altitudeFt / 100)}`,
        fromAltFt: level,
        toAltFt: fix.altitudeFt,
        trigger: { kind: 'fix', fixIdent: where.ident, fixIndex: at, lat: where.lat, lon: where.lon },
        plannedWeightKg: where.plannedWeightKg
      })
    }
    level = fix.altitudeFt
  }
  return steps
}

/** Steps given as "after N NM of level cruise, climb to FLxxx" - no route needed. */
export function manualPlan(steps: { afterNm: number; toFl: number }[]): FlightPlan {
  return {
    source: 'manual',
    origin: '',
    destination: '',
    generatedAt: null,
    initialAltFt: 0,
    route: [],
    steps: steps.map((s, i) => ({
      id: `manual-${i + 1}`,
      label: `+${s.afterNm} NM to FL${s.toFl}`,
      fromAltFt: 0,
      toAltFt: s.toFl * 100,
      trigger: { kind: 'distance' as const, afterNm: s.afterNm },
      plannedWeightKg: null
    }))
  }
}

export async function fetchSimbriefOfp(who: { username?: string; userId?: string }, timeoutMs = 20_000): Promise<unknown> {
  const query = who.userId
    ? `userid=${encodeURIComponent(who.userId)}`
    : who.username
      ? `username=${encodeURIComponent(who.username)}`
      : null
  if (!query) throw new Error('Set simbrief.username or simbrief.userId in config.json')
  const res = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?${query}&json=1`, {
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`SimBrief returned HTTP ${res.status}`)
  return res.json()
}
