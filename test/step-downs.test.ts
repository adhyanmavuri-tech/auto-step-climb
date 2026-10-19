import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FlightPlan } from '../src/types.ts'
import { STEP_ALONG_NM, clicksOf, engagesOf, makeAircraft, makeEngine, makePlan, run } from './helpers.ts'

/** The standard plan with its one step turned around: FL360 down to FL340 at FIX2. */
function downPlan(): FlightPlan {
  const plan = makePlan()
  plan.steps = [{ ...plan.steps[0]!, label: 'FIX2 FL340', fromAltFt: 36000, toAltFt: 34000 }]
  return plan
}

/** Up at FIX1, back down at FIX2, up again at FIX3, all between FL340 and FL360. */
function upDownUpPlan(): FlightPlan {
  const plan = makePlan()
  const at = (i: number) => {
    const f = plan.route[i]!
    return { kind: 'fix' as const, fixIdent: f.ident, fixIndex: i, lat: f.lat, lon: f.lon }
  }
  const step = (i: number, from: number, to: number) => ({
    id: `step-${i}`,
    label: `FIX${i} FL${to / 100}`,
    fromAltFt: from,
    toAltFt: to,
    trigger: at(i),
    plannedWeightKg: plan.route[i]!.plannedWeightKg
  })
  plan.steps = [step(1, 34000, 36000), step(2, 36000, 34000), step(3, 34000, 36000)]
  return plan
}

describe('step downs', () => {
  it('flies one when the option is on: FCU down, managed descent, done', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine({ stepDowns: true }, downPlan())
    const phases = new Set<string>()
    const sent = run(engine, ac, 1200, () => phases.add(engine.status.phase))

    const first = sent[0]!
    assert.ok(first.alongNm >= STEP_ALONG_NM - 0.01 && first.alongNm < STEP_ALONG_NM + 0.5, `first command at ${first.alongNm}, fix at ${STEP_ALONG_NM}`)
    assert.equal(clicksOf(sent).length, 20)
    assert.ok(clicksOf(sent).every((s) => s.cmd.type === 'fcu-click' && s.cmd.dir === -1), 'the FCU is turned down')
    assert.deepEqual(engagesOf(sent), [{ type: 'engage', mode: 'managed' }])
    assert.equal(ac.altFt, 34000)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.ok(phases.has('descending') && !phases.has('climbing'))
    assert.ok(engine.logs.some((l) => l.text.includes('managed descent (PUSH)')))
  })

  it('skips one while the option is off', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine({}, downPlan())
    assert.equal(run(engine, ac, 1200).length, 0)
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'skipped')
    assert.match(st.note, /step downs are switched off/)
    assert.equal(ac.altFt, 36000)
  })

  it('is off by default', () => {
    assert.equal(makeEngine().status.stepDowns, false)
    assert.equal(makeEngine({ stepDowns: true }).status.stepDowns, true)
  })

  it('can be switched on while flying', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine({}, downPlan())
    run(engine, ac, 100)
    engine.setOptions({ stepDowns: true })
    run(engine, ac, 1100)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 34000)
  })

  it('is flown by Step now even with the option off', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine({}, downPlan())
    run(engine, ac, 100)
    assert.equal(engine.stepNow(), true)
    run(engine, ac, 400)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 34000)
  })

  it('is skipped when the aircraft is already at or below the target', () => {
    const ac = makeAircraft(500, 34200)
    const engine = makeEngine({ stepDowns: true }, downPlan())
    assert.equal(run(engine, ac, 1200).length, 0)
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'skipped')
    assert.match(st.note, /already at or below FL340/)
  })

  it('is not held back by a heavy aircraft', () => {
    const ac = makeAircraft(500, 36000)
    ac.weightKg = 215_000 // far above the plan: a climb would be held
    const engine = makeEngine({ stepDowns: true }, downPlan())
    run(engine, ac, 1200)
    assert.equal(ac.altFt, 34000)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('falls back to an open descent when the managed one starts nothing', () => {
    const ac = makeAircraft(500, 36000)
    ac.pushWorks = false
    const engine = makeEngine({ stepDowns: true }, downPlan())
    const sent = run(engine, ac, 1500)
    assert.deepEqual(engagesOf(sent), [
      { type: 'engage', mode: 'managed' },
      { type: 'engage', mode: 'open' }
    ])
    assert.equal(ac.altFt, 34000)
    assert.ok(engine.logs.some((l) => l.text.includes('No descent after the managed descent (PUSH)')))
  })

  it('puts the FCU back when neither mode starts a descent', () => {
    const ac = makeAircraft(500, 36000)
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine({ stepDowns: true }, downPlan())
    const sent = run(engine, ac, 1600)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.match(engine.status.steps[0]!.note, /No descent after the descent command/)
    assert.equal(ac.fcuSelectedFt, 36000)
    assert.equal(ac.altFt, 36000)
    assert.equal(clicksOf(sent).length, 40, '20 clicks down, 20 back up')
  })

  it('levels off where it is if the descent stalls part-way', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine({ stepDowns: true }, downPlan())
    run(engine, ac, 1200, (a) => {
      if (a.altFt < 35_500) a.canDescend = false
    })
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'failed')
    assert.match(st.note, /descent stalled/)
    assert.equal(ac.fcuSelectedFt, Math.floor(ac.altFt / 100) * 100)
  })

  it('does not stop a climb from working afterwards: up, down, up in order', () => {
    const ac = makeAircraft(250, 34000)
    const engine = makeEngine({ stepDowns: true }, upDownUpPlan())
    const sent = run(engine, ac, 6000)
    assert.deepEqual(engine.status.steps.map((s) => s.status), ['done', 'done', 'done'])
    assert.equal(ac.altFt, 36000)
    assert.equal(engagesOf(sent).length, 3)
    const dirs = clicksOf(sent).map((s) => (s.cmd.type === 'fcu-click' ? s.cmd.dir : 0))
    assert.deepEqual(dirs, [...Array(20).fill(1), ...Array(20).fill(-1), ...Array(20).fill(1)])
  })

  it('with the option off, the climb back up after a skipped step down is skipped too', () => {
    const ac = makeAircraft(250, 34000)
    const engine = makeEngine({}, upDownUpPlan())
    run(engine, ac, 6000)
    const [up1, down, up2] = engine.status.steps
    assert.equal(up1!.status, 'done')
    assert.equal(down!.status, 'skipped')
    assert.equal(up2!.status, 'skipped')
    assert.match(up2!.note, /already at or above FL360/)
    assert.equal(ac.altFt, 36000)
  })
})
