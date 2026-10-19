import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FakeAircraft } from '../src/fake-sim.ts'
import { manualPlan } from '../src/plan.ts'
import { RouteTracker } from '../src/route-tracker.ts'
import { engagesOf, makeAircraft, makeEngine, makeRoute, makeStepPlan, run } from './helpers.ts'
import type { Sent } from './helpers.ts'

const alongOf = (fixIndex: number): number => new RouteTracker(makeRoute()).fixAlongNm(fixIndex)

/** The first command of each step: the very first one, and the one right after each engage. */
const stepStarts = (sent: Sent[]): Sent[] => sent.filter((s, i) => i === 0 || sent[i - 1]!.cmd.type === 'engage')

describe('several steps in a row', () => {
  it('flies each climb at its own fix, one after the other', () => {
    const ac = makeAircraft(250, 32000)
    const engine = makeEngine({}, makeStepPlan([[1, 32000, 34000], [2, 34000, 36000], [3, 36000, 38000]]))
    const sent = run(engine, ac, 6000)

    assert.deepEqual(engine.status.steps.map((s) => s.status), ['done', 'done', 'done'])
    assert.equal(ac.altFt, 38000)
    assert.equal(engagesOf(sent).length, 3)
    const starts = stepStarts(sent)
    assert.equal(starts.length, 3)
    ;[1, 2, 3].forEach((fix, k) => {
      const at = starts[k]!.alongNm
      assert.ok(at >= alongOf(fix) - 0.01 && at < alongOf(fix) + 1, `step ${k + 1} started at ${at} NM, its fix is at ${alongOf(fix)} NM`)
    })
  })

  it('still flies a step whose fix comes just after the one before it', () => {
    // Two fixes 12 NM apart: the second step waits for the first climb to finish and the aircraft to
    // settle, so it starts a few NM after its own fix, well inside the late window.
    const route = makeRoute()
    route[1] = { ...route[1]!, lon: 9.8 }
    const plan = makeStepPlan([[1, 32000, 34000], [2, 34000, 36000]])
    plan.route = route
    const ac = new FakeAircraft({ route, startAlongNm: 560, altFt: 32000 })
    const engine = makeEngine({}, plan)
    const sent = run(engine, ac, 1500)

    assert.deepEqual(engine.status.steps.map((s) => s.status), ['done', 'done'])
    assert.equal(ac.altFt, 36000)
    const second = stepStarts(sent)[1]!
    const fix2 = new RouteTracker(route).fixAlongNm(2)
    assert.ok(second.alongNm > fix2 && second.alongNm < fix2 + 40, `second step started at ${second.alongNm} NM, its fix is at ${fix2}`)
  })

  it('carries on with the next step when one fails', () => {
    const ac = makeAircraft(250, 34000)
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine({}, makeStepPlan([[1, 34000, 36000], [2, 36000, 38000]]))
    run(engine, ac, 6000, (a) => {
      if (engine.status.steps[0]!.status === 'failed') {
        a.pushWorks = true
        a.pullWorks = true
      }
    })
    assert.deepEqual(engine.status.steps.map((s) => s.status), ['failed', 'done'])
    // The second step starts from where the aircraft really is: 4,000 ft, the largest step allowed.
    assert.equal(ac.altFt, 38000)
  })

  it('does not take a step that would be more than the step limit above the aircraft', () => {
    const ac = makeAircraft(250, 32000)
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine({}, makeStepPlan([[1, 32000, 34000], [2, 34000, 36000], [3, 36000, 38000]]))
    run(engine, ac, 8000)
    const [a, b, c] = engine.status.steps
    assert.equal(a!.status, 'failed')
    assert.equal(b!.status, 'failed')
    assert.equal(c!.status, 'skipped', 'FL380 is 6,000 ft above where the aircraft still is')
    assert.match(c!.note, /more than the 4000 ft step limit/)
    assert.equal(ac.altFt, 32000)
  })

  it('counts each +NM step from the end of the step before it', () => {
    const ac = makeAircraft(0)
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }, { afterNm: 80, toFl: 380 }]))
    const sent = run(engine, ac, 3000)

    assert.deepEqual(engine.status.steps.map((s) => s.status), ['done', 'done'])
    const starts = stepStarts(sent)
    assert.ok(starts[0]!.alongNm > 49 && starts[0]!.alongNm < 60, `first step started at ${starts[0]!.alongNm} NM`)
    // The first step ends about 64 NM along. 80 NM after that is about 144 NM, not 80 NM along.
    assert.ok(starts[1]!.alongNm > 135 && starts[1]!.alongNm < 155, `second step started at ${starts[1]!.alongNm} NM`)
  })
})
