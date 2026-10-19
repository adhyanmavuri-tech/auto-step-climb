import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalIdent, formatSteps, parseStepLines } from '../src/step-lines.ts'
import type { RouteFix } from '../src/types.ts'

const fix = (ident: string, lon: number, stage: string): RouteFix => ({
  ident,
  lat: 50,
  lon,
  altitudeFt: 34000,
  stage,
  plannedWeightKg: 200_000 - Math.abs(lon) * 100
})

const route: RouteFix[] = [
  fix('EGLL', 0, 'CLB'),
  fix('LAM', -1, 'CLB'),
  fix('TOC', -3, 'CLB'),
  fix('ARKIN', -10, 'CRZ'),
  fix('KOMAK', -20, 'CRZ'),
  fix('LAM', -25, 'CRZ'),
  fix('NEEKO', -30, 'CRZ')
]

describe('step box lines', () => {
  it('reads WAYPOINT/FL the way the MCDU takes it', () => {
    const { steps, errors } = parseStepLines('ARKIN/370', route, 34000)
    assert.deepEqual(errors, [])
    assert.equal(steps.length, 1)
    const s = steps[0]!
    assert.equal(s.label, 'ARKIN FL370')
    assert.equal(s.fromAltFt, 34000)
    assert.equal(s.toAltFt, 37000)
    assert.equal(s.trigger.kind === 'fix' ? s.trigger.fixIndex : -1, 3)
    assert.equal(s.plannedWeightKg, 200_000 - 1_000)
  })

  it('accepts FL prefix, feet, a space and any case', () => {
    const { steps, errors } = parseStepLines('arkin/FL370\nKOMAK 39000\n neeko , 410', route, 34000)
    assert.deepEqual(errors, [])
    assert.deepEqual(steps.map((s) => s.toAltFt), [37000, 39000, 41000])
  })

  it('puts steps in route order and chains the from-levels', () => {
    const { steps } = parseStepLines('KOMAK/390\nARKIN/370', route, 34000)
    assert.deepEqual(steps.map((s) => [s.label, s.fromAltFt, s.toAltFt]), [
      ['ARKIN FL370', 34000, 37000],
      ['KOMAK FL390', 37000, 39000]
    ])
  })

  it('picks the occurrence after the top of climb when a name repeats', () => {
    const { steps } = parseStepLines('LAM/370', route, 34000)
    assert.equal(steps[0]!.trigger.kind === 'fix' ? steps[0]!.trigger.fixIndex : -1, 5)
  })

  it('ignores blank lines and # comments', () => {
    const { steps, errors } = parseStepLines('# my steps\n\nARKIN/370  # first\n', route, 34000)
    assert.deepEqual(errors, [])
    assert.equal(steps.length, 1)
  })

  it('reports every problem and returns no steps at all', () => {
    const { steps, errors } = parseStepLines('NOPE/370\nARKIN/08\nhello world\nKOMAK/390', route, 34000)
    assert.equal(steps.length, 0)
    assert.equal(errors.length, 3)
    assert.match(errors[0]!, /Line 1: NOPE is not on the OFP route/)
    assert.match(errors[1]!, /Line 2: 800 ft is outside the 1,000-45,000/)
    assert.match(errors[2]!, /Line 3: "hello world" is not WAYPOINT\/FL/)
  })

  it('refuses a duplicate waypoint and a level that repeats the step before', () => {
    assert.match(parseStepLines('ARKIN/370\nARKIN/390', route, 34000).errors[0]!, /listed twice/)
    assert.match(parseStepLines('ARKIN/390\nKOMAK/390', route, 34000).errors[0]!, /same level as the step before/)
  })

  it('accepts a step down', () => {
    const { steps, errors } = parseStepLines('ARKIN/390\nKOMAK/370', route, 34000)
    assert.deepEqual(errors, [])
    assert.deepEqual(steps.map((s) => [s.label, s.fromAltFt, s.toAltFt]), [
      ['ARKIN FL390', 34000, 39000],
      ['KOMAK FL370', 39000, 37000]
    ])
  })

  it('has no route to look names up on without an OFP', () => {
    assert.match(parseStepLines('ARKIN/370', [], 0).errors[0]!, /no OFP route/)
  })

  it('supports +NM/FL steps without a route', () => {
    const { steps, errors } = parseStepLines('+300/370\n+650/390', [], 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(steps.map((s) => (s.trigger.kind === 'distance' ? s.trigger.afterNm : -1)), [300, 650])
    assert.equal(steps[0]!.label, '+300 NM FL370')
  })

  it('accepts a low level, for testing a step well below cruise', () => {
    const { steps, errors } = parseStepLines('+2/60', [], 0)
    assert.deepEqual(errors, [])
    assert.equal(steps[0]!.toAltFt, 6000)
  })

  it('does not mix waypoint steps with +NM steps', () => {
    assert.match(parseStepLines('ARKIN/370\n+300/390', route, 34000).errors.join('\n'), /not both/)
  })

  it('formatSteps is the inverse', () => {
    const text = 'ARKIN/370\nKOMAK/390'
    assert.equal(formatSteps(parseStepLines(text, route, 34000).steps), text)
    assert.equal(formatSteps(parseStepLines('+300/370', [], 0).steps), '+300/370')
  })
})

/** A route point at a given position, for names that stand for one. */
const at = (ident: string, lat: number, lon: number): RouteFix => ({ ...fix(ident, lon, 'CRZ'), lat })

type Quadrant = [arinc: string, icao: string, lat: number, lon: number]

/** The same eight whole-degree points in the MCDU's spelling and the OFP's: every quadrant, both sides of 100 degrees. */
const QUADRANTS: Quadrant[] = [
  ['4020N', '40N020W', 40, -20],
  ['4020E', '40N020E', 40, 20],
  ['4020S', '40S020E', -40, 20],
  ['4020W', '40S020W', -40, -20],
  ['32N35', '32N135W', 32, -135],
  ['32E35', '32N135E', 32, 135],
  ['32S35', '32S135E', -32, 135],
  ['32W35', '32S135W', -32, -135]
]

/** The OFP for KSFO-NFFN carries its oceanic step points as 32N135W and 15N155W; the MCDU shows 32N35 and 15N55. */
const pacific: RouteFix[] = [
  fix('KSFO', -122, 'CLB'),
  fix('TOC', -125, 'CLB'),
  at('32N135W', 32, -135),
  at('15N155W', 15, -155),
  fix('NFFN', 177, 'DSC')
]

describe('latitude/longitude waypoints, MCDU and OFP spelling', () => {
  it('takes the MCDU names 32N35 and 15N55 for 32N135W and 15N155W', () => {
    const { steps, errors } = parseStepLines('32N35/380\n15N55/400', pacific, 36000)
    assert.deepEqual(errors, [])
    assert.deepEqual(steps.map((s) => [s.label, s.fromAltFt, s.toAltFt]), [
      ['32N135W FL380', 36000, 38000],
      ['15N155W FL400', 38000, 40000]
    ])
    assert.deepEqual(steps[0]!.trigger, { kind: 'fix', fixIdent: '32N135W', fixIndex: 2, lat: 32, lon: -135 })
    assert.deepEqual(steps[1]!.trigger, { kind: 'fix', fixIdent: '15N155W', fixIndex: 3, lat: 15, lon: -155 })
    assert.equal(steps[0]!.plannedWeightKg, 200_000 - 13_500)
  })

  it('reads the STEP ALTS page as the MCDU shows it, and the OFP spelling gives the same steps', () => {
    const page = parseStepLines('32N35 FL380\n15N55 FL400', pacific, 36000)
    assert.deepEqual(page.errors, [])
    assert.deepEqual(page, parseStepLines('32N135W/380\n15N155W/400', pacific, 36000))
    assert.deepEqual(page, parseStepLines('32n35/fl380\n15n55/fl400', pacific, 36000))
  })

  it('tells a longitude below 100 from one above by where the letter sits', () => {
    const route = [fix('TOC', -3, 'CLB'), at('40N020W', 40, -20), at('40N120W', 40, -120)]
    assert.equal(parseStepLines('4020N/380', route, 36000).steps[0]!.label, '40N020W FL380')
    assert.equal(parseStepLines('40N20/380', route, 36000).steps[0]!.label, '40N120W FL380')
  })

  it('gives each quadrant letter its hemispheres', () => {
    const route = QUADRANTS.map(([, icao, lat, lon]) => at(icao, lat, lon))
    for (const [arinc, icao, lat, lon] of QUADRANTS) {
      const { steps, errors } = parseStepLines(`${arinc}/380`, route, 36000)
      assert.deepEqual(errors, [], arinc)
      const t = steps[0]!.trigger
      assert.deepEqual(t.kind === 'fix' ? [t.fixIdent, t.lat, t.lon] : null, [icao, lat, lon], arinc)
    }
  })

  it('finds a route fix spelled the MCDU way when the ICAO name is typed, and names the step as the route does', () => {
    const route = QUADRANTS.map(([arinc, , lat, lon]) => at(arinc, lat, lon))
    for (const [arinc, icao, lat, lon] of QUADRANTS) {
      const { steps, errors } = parseStepLines(`${icao}/380`, route, 36000)
      assert.deepEqual(errors, [], icao)
      const t = steps[0]!.trigger
      assert.equal(steps[0]!.label, `${arinc} FL380`)
      assert.deepEqual(t.kind === 'fix' ? [t.fixIdent, t.lat, t.lon] : null, [arinc, lat, lon], icao)
    }
  })

  it('writes the route spelling back into the box', () => {
    assert.equal(formatSteps(parseStepLines('32N35/380\n15N55/400', pacific, 36000).steps), '32N135W/380\n15N155W/400')
  })

  it('counts both spellings of one waypoint as one waypoint', () => {
    assert.match(parseStepLines('32N35/380\n32N135W/400', pacific, 36000).errors[0]!, /Line 2: 32N135W is listed twice/)
  })

  it('does not guess when a name cannot be that position', () => {
    const route = [fix('TOC', -3, 'CLB'), at('32N085W', 32, -85), at('32N035W', 32, -35)]
    // A letter in the middle only ever means 100-179: 32N85 is not 085W, and 32N35 is 135W, not 035W.
    assert.deepEqual(parseStepLines('32N85/380', route, 36000).errors, ['Line 1: 32N85 is not on the OFP route'])
    assert.deepEqual(parseStepLines('32N35/380', route, 36000).errors, ['Line 1: 32N35 is not on the OFP route'])
    assert.equal(parseStepLines('3235N/380', route, 36000).steps[0]!.label, '32N035W FL380')
  })

  it('leaves ordinary names alone', () => {
    const route = [fix('TOC', -3, 'CLB'), fix('ABCDE', -10, 'CRZ'), fix('DAGAG', -20, 'CRZ'), at('32N135W', 32, -135)]
    const { steps, errors } = parseStepLines('dagag/390\nabcde/370', route, 34000)
    assert.deepEqual(errors, [])
    assert.deepEqual(steps.map((s) => [s.label, s.trigger.kind === 'fix' ? s.trigger.fixIndex : -1]), [
      ['ABCDE FL370', 1],
      ['DAGAG FL390', 2]
    ])
    // Not a lat/long name, and not on the route either.
    assert.deepEqual(parseStepLines('ABCDF/370', route, 34000).errors, ['Line 1: ABCDF is not on the OFP route'])
  })

  it('words an unknown name the same way whatever it looks like', () => {
    assert.deepEqual(parseStepLines('NOPE/380', pacific, 36000).errors, ['Line 1: NOPE is not on the OFP route'])
    assert.deepEqual(parseStepLines('10N20/380', pacific, 36000).errors, ['Line 1: 10N20 is not on the OFP route'])
    assert.deepEqual(parseStepLines('32N35/380', [], 0).errors, [
      'Line 1: there is no OFP route to look 32N35 up on - load an OFP or use +NM/FL'
    ])
  })
})

describe('canonicalIdent', () => {
  it('gives the ICAO spelling of a whole-degree position from either spelling, in any case', () => {
    for (const [arinc, icao] of QUADRANTS) {
      assert.equal(canonicalIdent(arinc), icao)
      assert.equal(canonicalIdent(arinc.toLowerCase()), icao)
      assert.equal(canonicalIdent(icao), icao)
    }
  })

  it('leaves every other name as it is, in upper case', () => {
    for (const name of ['ABCDE', 'DAGAG', 'ARKIN', 'LAM', 'TOC', 'EGLL', 'N0123']) {
      assert.equal(canonicalIdent(name), name)
      assert.equal(canonicalIdent(name.toLowerCase()), name)
    }
  })

  it('leaves alone a five-character name that cannot be a position', () => {
    // Longitude 180 or more, latitude above 90, or the wrong number of digits.
    for (const name of ['32N85', '32N80', '95N35', '9520N', '32N1', '3N135']) assert.equal(canonicalIdent(name), name)
  })
})
