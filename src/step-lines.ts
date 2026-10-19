import type { PlannedStep, RouteFix } from './types.ts'

export interface ParsedSteps {
  steps: PlannedStep[]
  errors: string[]
}

/** "ARKIN/370", "ARKIN/FL370", "ARKIN 37000" or "+300/370" (300 NM after level-off). */
const LINE = /^(\+\d+(?:\.\d+)?|[A-Z0-9]{2,8})\s*[/\s,;]\s*(?:FL\s*)?(\d{2,5})$/i

/** ARINC 424 quadrant letter -> latitude and longitude hemisphere: N = N/W, E = N/E, S = S/E, W = S/W. */
const QUADRANT: Record<string, readonly [lat: string, lon: string]> = {
  N: ['N', 'W'],
  E: ['N', 'E'],
  S: ['S', 'E'],
  W: ['S', 'W']
}

/** DDQLL: the quadrant letter in the middle, longitude 100-179 (32N35 is 32N 135W). */
const ARINC_LETTER_MID = /^(\d{2})([NESW])(\d{2})$/
/** DDLLQ: the quadrant letter last, longitude 0-99 (4020N is 40N 020W). */
const ARINC_LETTER_END = /^(\d{2})(\d{2})([NESW])$/

const icaoName = (lat: string, quadrant: string, lon: string): string => {
  const [ns, ew] = QUADRANT[quadrant]!
  return `${lat}${ns}${lon}${ew}`
}

/**
 * A whole-degree latitude/longitude waypoint has two spellings: the five-character ARINC 424 name the
 * MCDU shows (32N35, 4020N) and the seven-character ICAO name an OFP route carries (32N135W, 40N020W).
 * Gives the ICAO one for either and any other name as it is (upper case), so two names can be compared
 * whichever way each was spelled. A five-character name that can't be a position is left alone.
 */
export function canonicalIdent(ident: string): string {
  const name = ident.toUpperCase()
  const mid = ARINC_LETTER_MID.exec(name)
  if (mid && Number(mid[1]) <= 90 && Number(mid[3]) <= 79) return icaoName(mid[1]!, mid[2]!, `1${mid[3]}`)
  const end = ARINC_LETTER_END.exec(name)
  if (end && Number(end[1]) <= 90) return icaoName(end[1]!, end[3]!, `0${end[2]}`)
  return name
}

/** Errors read best in the order of the lines they belong to; general ones go last. */
const lineOf = (e: string): number => Number(/^Line (\d+):/.exec(e)?.[1] ?? Number.MAX_SAFE_INTEGER)
const inLineOrder = (errors: string[]): string[] => [...errors].sort((a, b) => lineOf(a) - lineOf(b))

/** Three digits or fewer mean a flight level, more mean feet. */
const levelFt = (digits: string): number => {
  const n = Number(digits)
  return n < 1000 ? n * 100 : n
}

interface ParsedLine {
  line: number
  ident: string
  afterNm: number | null
  toAltFt: number
}

/**
 * Turns what the pilot types into the step box into steps. The format is the one the MCDU's STEP ALTS
 * entry uses (WAYPOINT/FL), looked up on the OFP route. `+NM/FL` is the route-free alternative.
 * A latitude/longitude waypoint can be typed the MCDU's way (32N35) or the OFP's (32N135W), whichever
 * way the route spells it; the step is named as the route spells it.
 * All or nothing: if any line is wrong, no steps are returned, so a typo can't silently drop a step.
 */
export function parseStepLines(text: string, route: RouteFix[], initialAltFt: number): ParsedSteps {
  const errors: string[] = []
  const lines: ParsedLine[] = []

  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') return
    const m = LINE.exec(line)
    if (!m) {
      errors.push(`Line ${n}: "${line}" is not WAYPOINT/FL (for example ARKIN/370) or +NM/FL (for example +300/370)`)
      return
    }
    const where = m[1]!.toUpperCase()
    const toAltFt = levelFt(m[2]!)
    if (toAltFt < 1_000 || toAltFt > 45_000) {
      errors.push(`Line ${n}: ${toAltFt.toLocaleString('en-US')} ft is outside the 1,000-45,000 ft range for a step`)
      return
    }
    lines.push({
      line: n,
      ident: where,
      afterNm: where.startsWith('+') ? Number(where.slice(1)) : null,
      toAltFt
    })
  })

  const byDistance = lines.filter((l) => l.afterNm !== null)
  if (byDistance.length > 0 && byDistance.length < lines.length) {
    errors.push('Use either WAYPOINT/FL lines or +NM/FL lines, not both')
  }

  type Resolved = ParsedLine & { fixIndex: number | null }
  const resolved: Resolved[] = []
  const routeNames = route.map((f) => canonicalIdent(f.ident))
  for (const l of lines) {
    if (l.afterNm !== null) {
      resolved.push({ ...l, fixIndex: null })
      continue
    }
    const wanted = canonicalIdent(l.ident)
    const matches: number[] = []
    routeNames.forEach((name, idx) => {
      if (name === wanted) matches.push(idx)
    })
    if (matches.length === 0) {
      errors.push(
        route.length === 0
          ? `Line ${l.line}: there is no OFP route to look ${l.ident} up on - load an OFP or use +NM/FL`
          : `Line ${l.line}: ${l.ident} is not on the OFP route`
      )
      continue
    }
    // The same name can appear in a SID or STAR; the step belongs to the one after the top of climb.
    const idx = matches.find((i) => route[i]!.stage !== 'CLB') ?? matches[0]!
    if (resolved.some((r) => r.fixIndex === idx)) {
      errors.push(`Line ${l.line}: ${l.ident} is listed twice`)
      continue
    }
    resolved.push({ ...l, fixIndex: idx })
  }

  if (errors.length > 0) return { steps: [], errors: inLineOrder(errors) }

  resolved.sort((a, b) => (a.fixIndex !== null && b.fixIndex !== null ? a.fixIndex - b.fixIndex : (a.afterNm ?? 0) - (b.afterNm ?? 0)))

  const steps: PlannedStep[] = []
  let previousAlt = initialAltFt
  for (let k = 0; k < resolved.length; k++) {
    const r = resolved[k]!
    if (k > 0 && r.toAltFt === previousAlt) {
      errors.push(`Line ${r.line}: FL${Math.round(r.toAltFt / 100)} is the same level as the step before it`)
      continue
    }
    const fix = r.fixIndex !== null ? route[r.fixIndex]! : null
    const fl = Math.round(r.toAltFt / 100)
    steps.push({
      id: `step-${k + 1}`,
      // The route's own spelling, so 32N35 and 32N135W give the label the OFP's step has.
      label: fix ? `${fix.ident.toUpperCase()} FL${fl}` : `+${r.afterNm} NM FL${fl}`,
      fromAltFt: previousAlt,
      toAltFt: r.toAltFt,
      trigger:
        fix && r.fixIndex !== null
          ? { kind: 'fix', fixIdent: fix.ident, fixIndex: r.fixIndex, lat: fix.lat, lon: fix.lon }
          : { kind: 'distance', afterNm: r.afterNm ?? 0 },
      plannedWeightKg: fix?.plannedWeightKg ?? null
    })
    previousAlt = r.toAltFt
  }
  return errors.length > 0 ? { steps: [], errors: inLineOrder(errors) } : { steps, errors }
}

/** The inverse, for filling the box from a loaded plan. */
export function formatSteps(steps: PlannedStep[]): string {
  return steps
    .map((s) => {
      const fl = Math.round(s.toAltFt / 100)
      return s.trigger.kind === 'fix' ? `${s.trigger.fixIdent}/${fl}` : `+${s.trigger.afterNm}/${fl}`
    })
    .join('\n')
}
