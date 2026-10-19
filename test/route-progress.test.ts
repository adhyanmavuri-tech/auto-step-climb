import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cruiseSpan } from '../src/engine.ts'
import { manualPlan } from '../src/plan.ts'
import { RouteTracker } from '../src/route-tracker.ts'
import type { RouteFix } from '../src/types.ts'
import { STEP_ALONG_NM, makeAircraft, makeEngine, makePlan, makeStepPlan, run } from './helpers.ts'

/** Fixes one degree (60 NM) apart along the equator, with these names and stages. */
function route(fixes: [string, string][]): RouteFix[] {
  return fixes.map(([ident, stage], i) => ({ ident, lat: 0, lon: i, altitudeFt: stage === 'CRZ' ? 36000 : 10000, stage, plannedWeightKg: null }))
}

describe('where the aircraft is on the route', () => {
  it('says how far along the planned route the aircraft is, and where each step is', () => {
    const ac = makeAircraft(500)
    const engine = makeEngine({ live: false })
    run(engine, ac, 3)
    const s = engine.status
    assert.ok(s.alongNm !== null && Math.abs(s.alongNm - ac.alongNm) < 3, `along ${s.alongNm}, the aircraft is at ${ac.alongNm}`)
    assert.equal(s.steps[0]!.atNm, STEP_ALONG_NM)
    assert.equal(s.route?.totalNm, new RouteTracker(makePlan().route).totalNm)
  })

  it('has no position until the aircraft has been read, and forgets it when the plan changes', () => {
    const engine = makeEngine({ live: false })
    assert.equal(engine.status.alongNm, null)
    assert.ok(engine.status.route !== null)
    run(engine, makeAircraft(500), 2)
    assert.ok(engine.status.alongNm !== null)
    engine.setPlan(makePlan())
    assert.equal(engine.status.alongNm, null)
  })

  it('gives each step its place on the route, in route order', () => {
    const plan = makeStepPlan([
      [1, 34000, 36000],
      [3, 36000, 38000]
    ])
    const engine = makeEngine({}, plan)
    const tracker = new RouteTracker(plan.route)
    const places = engine.status.steps.map((x) => x.atNm)
    assert.deepEqual(places, [tracker.fixAlongNm(1), tracker.fixAlongNm(3)])
    assert.ok(places[0]! < places[1]!)
  })

  it('has no route to measure along when the steps are counted in distance flown', () => {
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }]))
    const s = engine.status
    assert.equal(s.route, null)
    assert.equal(s.alongNm, null)
    assert.equal(s.steps[0]!.atNm, null)
  })

  it('has nothing at all with no plan', () => {
    const engine = makeEngine({}, null)
    assert.equal(engine.status.route, null)
    assert.deepEqual(engine.status.steps, [])
  })
})

describe('the part of the route the chart covers', () => {
  it('runs from the top of climb to the top of descent', () => {
    const fixes = route([['DEP', 'CLB'], ['TOC', 'CLB'], ['A', 'CRZ'], ['B', 'CRZ'], ['TOD', 'CRZ'], ['ARR', 'DSC']])
    const span = cruiseSpan({ ...makePlan(), route: fixes }, new RouteTracker(fixes))
    const t = new RouteTracker(fixes)
    assert.deepEqual(span, { fromNm: t.fixAlongNm(1), toNm: t.fixAlongNm(4), totalNm: t.fixAlongNm(5) })
  })

  it('starts at the first cruise fix when the OFP names no top of climb, and ends at the first descent fix', () => {
    const fixes = route([['DEP', 'CLB'], ['X', 'CLB'], ['A', 'CRZ'], ['B', 'CRZ'], ['Y', 'DSC'], ['ARR', 'DSC']])
    const span = cruiseSpan({ ...makePlan(), route: fixes }, new RouteTracker(fixes))
    const t = new RouteTracker(fixes)
    assert.equal(span.fromNm, t.fixAlongNm(2))
    assert.equal(span.toNm, t.fixAlongNm(4))
  })

  it('falls back to the whole route when it cannot tell, or the cruise would be nothing', () => {
    const noCruise = route([['DEP', 'CLB'], ['A', 'CLB'], ['ARR', 'DSC']])
    const t1 = new RouteTracker(noCruise)
    assert.deepEqual(cruiseSpan({ ...makePlan(), route: noCruise }, t1), { fromNm: 0, toNm: t1.totalNm, totalNm: t1.totalNm })

    // the descent starts less than a mile after the top of climb: nothing to draw, so show the whole route
    const nothing = route([['DEP', 'CLB'], ['TOC', 'CRZ'], ['ARR', 'DSC']])
    nothing[2]!.lon = 1.005
    const t2 = new RouteTracker(nothing)
    assert.deepEqual(cruiseSpan({ ...makePlan(), route: nothing }, t2), { fromNm: 0, toNm: t2.totalNm, totalNm: t2.totalNm })
  })

  it('is reported by the engine for a plan read from an OFP', () => {
    const fixes = route([['DEP', 'CLB'], ['TOC', 'CLB'], ['A', 'CRZ'], ['TOD', 'CRZ'], ['ARR', 'DSC']])
    const engine = makeEngine({}, { ...makePlan(), route: fixes, steps: [] })
    const t = new RouteTracker(fixes)
    assert.deepEqual(engine.status.route, { fromNm: t.fixAlongNm(1), toNm: t.fixAlongNm(3), totalNm: t.fixAlongNm(4) })
  })
})
