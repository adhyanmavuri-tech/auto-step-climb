import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectSteps, manualPlan, parseSimbriefOfp } from '../src/plan.ts'
import type { RouteFix } from '../src/types.ts'

/** A trimmed-down OFP in SimBrief's JSON shape: every number is a string, weights are in lbs. */
function ofp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fix = (ident: string, lon: number, alt: number, stage: string, onboard: number): Record<string, string> => ({
    ident,
    pos_lat: '52.0',
    pos_long: String(lon),
    altitude_feet: String(alt),
    stage,
    fuel_plan_onboard: String(onboard)
  })
  return {
    fetch: { status: 'Success' },
    params: { units: 'lbs', time_generated: '1760000000' },
    general: { initial_altitude: '34000' },
    weights: { est_zfw: '300000' },
    origin: { icao_code: 'EGLL' },
    destination: { icao_code: 'KJFK' },
    navlog: {
      fix: [
        fix('EGLL', -0.5, 0, 'CLB', 120000),
        fix('TOC', -3, 34000, 'CLB', 110000),
        fix('AAAAA', -10, 34000, 'CRZ', 100000),
        fix('BBBBB', -20, 36000, 'CRZ', 90000),
        fix('CCCCC', -30, 38000, 'CRZ', 70000),
        fix('TOD', -60, 38000, 'CRZ', 40000),
        fix('KJFK', -73, 0, 'DSC', 20000)
      ]
    },
    ...overrides
  }
}

describe('SimBrief OFP parsing', () => {
  it('reads route, airports and generation time', () => {
    const plan = parseSimbriefOfp(ofp())
    assert.equal(plan.origin, 'EGLL')
    assert.equal(plan.destination, 'KJFK')
    assert.equal(plan.route.length, 7)
    assert.equal(plan.initialAltFt, 34000)
    assert.equal(plan.generatedAt, new Date(1760000000 * 1000).toISOString())
    assert.equal(plan.route[2]!.lon, -10)
  })

  it("names the flight from SimBrief's ATC callsign, else from the airline and number", () => {
    const named = { initial_altitude: '34000', icao_airline: 'ALK', flight_number: '607' }
    assert.equal(parseSimbriefOfp(ofp({ atc: { callsign: 'ALK607' }, general: named })).flight, 'ALK607')
    assert.equal(parseSimbriefOfp(ofp({ atc: { callsign: ' Speedbird1 ' }, general: named })).flight, 'Speedbird1', 'a callsign set by hand wins')
    assert.equal(parseSimbriefOfp(ofp({ general: named })).flight, 'ALK607', 'no callsign: the airline and the number')
    assert.equal(parseSimbriefOfp(ofp({ atc: { callsign: '' }, general: { ...named, flight_number: 607 } })).flight, 'ALK607', 'a bare number is fine too')
    assert.equal(parseSimbriefOfp(ofp()).flight, '', 'nothing to name it by')
    assert.equal(parseSimbriefOfp(ofp({ atc: { callsign: 'X'.repeat(40) } })).flight?.length, 16, 'an absurdly long one is cut')
  })

  it('finds the step climbs from altitude changes', () => {
    const plan = parseSimbriefOfp(ofp())
    assert.deepEqual(
      plan.steps.map((s) => [s.label, s.fromAltFt, s.toAltFt]),
      [
        ['AAAAA FL360', 34000, 36000],
        ['BBBBB FL380', 36000, 38000]
      ]
    )
    const first = plan.steps[0]!
    assert.equal(first.trigger.kind, 'fix')
    assert.equal(first.trigger.kind === 'fix' ? first.trigger.fixIndex : -1, 2)
  })

  it('converts planned weights to kg using the OFP units', () => {
    const lbs = parseSimbriefOfp(ofp()).steps[0]!
    assert.ok(Math.abs(lbs.plannedWeightKg! - (300000 + 100000) * 0.45359237) < 0.01)

    const kgs = parseSimbriefOfp(ofp({ params: { units: 'kgs' } })).steps[0]!
    assert.equal(kgs.plannedWeightKg, 400000)
  })

  it("starts each step where SimBrief's own step list puts it", () => {
    // SimBrief names the fix where each climb begins; the navlog shows the new level one fix later.
    const listed = 'EGLL/0340/AAAAA/0360/BBBBB/0380'.split('/')
    const expected: [string, number][] = []
    for (let i = 2; i + 1 < listed.length; i += 2) expected.push([listed[i]!, Number(listed[i + 1]) * 100])
    const plan = parseSimbriefOfp(ofp({ general: { initial_altitude: '34000', stepclimb_string: listed.join('/') } }))
    assert.deepEqual(
      plan.steps.map((s) => [s.trigger.kind === 'fix' ? s.trigger.fixIdent : '', s.toAltFt]),
      expected
    )
  })

  it('can start the step at the first fix that shows the higher level', () => {
    const plan = parseSimbriefOfp(ofp(), { stepAt: 'fix' })
    const first = plan.steps[0]!
    assert.equal(first.trigger.kind === 'fix' ? first.trigger.fixIdent : '', 'BBBBB')
    assert.equal(first.toAltFt, 36000)
  })

  it('has no steps when the whole flight stays at one level', () => {
    const flat = ofp()
    const fixes = (flat.navlog as { fix: Record<string, string>[] }).fix
    fixes[3]!.altitude_feet = '34000'
    fixes[4]!.altitude_feet = '34000'
    fixes[5]!.altitude_feet = '34000'
    assert.equal(parseSimbriefOfp(flat).steps.length, 0)
  })

  it('rejects a response without a navlog', () => {
    assert.throws(() => parseSimbriefOfp({ fetch: { status: 'Success' } }), /no navlog fixes/)
  })

  it('surfaces a SimBrief error status', () => {
    assert.throws(() => parseSimbriefOfp({ fetch: { status: 'Error: Unknown UserID' } }), /Unknown UserID/)
  })

  it('rejects a navlog with a single fix', () => {
    const single = ofp({ navlog: { fix: { ident: 'ONLY', pos_lat: '1', pos_long: '2', altitude_feet: '0', stage: 'CLB' } } })
    assert.throws(() => parseSimbriefOfp(single), /fewer than two/)
  })
})

describe('detectSteps', () => {
  const fix = (ident: string, alt: number, stage = 'CRZ'): RouteFix => ({
    ident,
    lat: 0,
    lon: 0,
    altitudeFt: alt,
    stage,
    plannedWeightKg: null
  })

  it('includes step descents but ignores tiny changes', () => {
    const steps = detectSteps(
      [fix('TOC', 36000, 'CLB'), fix('A', 36000), fix('B', 34000), fix('C', 34400), fix('D', 36000), fix('E', 36000)],
      36000
    )
    assert.deepEqual(
      steps.map((s) => [s.label, s.fromAltFt, s.toAltFt]),
      [
        ['A FL340', 36000, 34000],
        ['C FL360', 34400, 36000]
      ]
    )
  })

  it("puts a step down and the climb back where SimBrief's own list does", () => {
    // Shaped like a real long-haul OFP: up, down for an airspace level, up again.
    const levels: [string, number, string][] = [
      ['EGLL', 0, 'CLB'], ['TOC', 39000, 'CLB'], ['AAAAA', 39000, 'CRZ'], ['BBBBB', 39000, 'CRZ'],
      ['CCCCC', 40000, 'CRZ'], ['DDDDD', 40000, 'CRZ'], ['EEEEE', 39000, 'CRZ'], ['FFFFF', 39000, 'CRZ'],
      ['GGGGG', 40000, 'CRZ'], ['HHHHH', 40000, 'CRZ'], ['TOD', 40000, 'CRZ'], ['KJFK', 0, 'DSC']
    ]
    const navlog = {
      fix: levels.map(([ident, alt, stage], i) => ({
        ident,
        pos_lat: '52',
        pos_long: String(-i * 3),
        altitude_feet: String(alt),
        stage,
        fuel_plan_onboard: '50000'
      }))
    }
    const plan = parseSimbriefOfp(ofp({ general: { initial_altitude: '39000' }, navlog }))
    // SimBrief's step list for this profile: BBBBB/0400/DDDDD/0390/FFFFF/0400
    assert.deepEqual(
      plan.steps.map((s) => [s.trigger.kind === 'fix' ? s.trigger.fixIdent : '', s.toAltFt]),
      [
        ['BBBBB', 40000],
        ['DDDDD', 39000],
        ['FFFFF', 40000]
      ]
    )
  })

  it('does not look past the top of descent', () => {
    const steps = detectSteps([fix('TOC', 34000, 'CLB'), fix('A', 34000), fix('TOD', 34000), fix('B', 38000)], 34000)
    assert.equal(steps.length, 0)
  })

  it('does not depend on how SimBrief labels the stage of the step fix', () => {
    const steps = detectSteps([fix('TOC', 34000, 'CLB'), fix('A', 34000), fix('B', 36000, 'CLB')], 34000)
    assert.deepEqual(steps.map((s) => s.label), ['A FL360'])
  })
})

describe('manual plan', () => {
  it('builds distance-based steps', () => {
    const plan = manualPlan([
      { afterNm: 300, toFl: 360 },
      { afterNm: 500, toFl: 380 }
    ])
    assert.equal(plan.source, 'manual')
    assert.deepEqual(plan.steps.map((s) => [s.toAltFt, s.trigger.kind === 'distance' ? s.trigger.afterNm : -1]), [
      [36000, 300],
      [38000, 500]
    ])
  })
})
