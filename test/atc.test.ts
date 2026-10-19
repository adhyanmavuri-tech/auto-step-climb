import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FlightPlan } from '../src/types.ts'
import { STEP_ALONG_NM, clicksOf, makeAircraft, makeEngine, makePlan, run } from './helpers.ts'
import type { Sent } from './helpers.ts'

const requestsOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'atc-request')
const cancelsOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'atc-cancel')

/** An aircraft with an ATC program connected. */
function withAtc(reply: 'grant' | 'refuse' | 'silent' | 'unavailable' = 'grant', alt = 34000) {
  const ac = makeAircraft(500, alt)
  ac.atc = { connected: true, request: null }
  ac.atcReply = reply
  return ac
}

function downPlan(): FlightPlan {
  const plan = makePlan()
  plan.steps = [{ ...plan.steps[0]!, label: 'FIX2 FL340', fromAltFt: 36000, toAltFt: 34000 }]
  return plan
}

describe('asking ATC first', () => {
  it('asks shortly before the step point and starts only once cleared', () => {
    const ac = withAtc()
    const engine = makeEngine({ atcFirst: true })
    const sent = run(engine, ac, 1200)

    const ask = requestsOf(sent)[0]!
    assert.deepEqual(ask.cmd, { type: 'atc-request', altFt: 36000 })
    assert.ok(ask.alongNm > STEP_ALONG_NM - 10.5 && ask.alongNm < STEP_ALONG_NM - 9, `asked at ${ask.alongNm} NM, the fix is at ${STEP_ALONG_NM}`)
    const firstClick = clicksOf(sent)[0]!
    assert.ok(firstClick.t > ask.t, 'the FCU is only touched after the request')
    assert.ok(firstClick.alongNm >= STEP_ALONG_NM - 0.01, 'and the climb still waits for the fix')
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
    assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360')))
  })

  it('never climbs when ATC says nothing: asks twice, then skips the step', () => {
    const ac = withAtc('silent')
    const engine = makeEngine({ atcFirst: true, atcTimeoutMs: 20_000, atcRetryMs: 30_000 })
    const sent = run(engine, ac, 1200)

    assert.equal(requestsOf(sent).length, 2)
    assert.ok(cancelsOf(sent).length >= 1, 'the open request is closed')
    assert.equal(clicksOf(sent).length, 0)
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'skipped')
    assert.match(st.note, /ATC did not clear FL360 \(no answer\)/)
    assert.equal(ac.altFt, 34000)
  })

  it('retries a refusal once, and a second refusal skips the step', () => {
    const ac = withAtc('refuse')
    const engine = makeEngine({ atcFirst: true, atcRetryMs: 30_000 })
    const sent = run(engine, ac, 1200)

    assert.equal(requestsOf(sent).length, 2)
    assert.equal(clicksOf(sent).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'skipped')
    assert.match(engine.status.steps[0]!.note, /ATC did not clear FL360/)
  })

  it('goes ahead when the second try is cleared', () => {
    const ac = withAtc('refuse')
    const engine = makeEngine({ atcFirst: true, atcRetryMs: 30_000 })
    const sent = run(engine, ac, 1200, (a) => {
      // the controller changes their mind once the first request has been turned down
      if (engine.logs.some((l) => l.text.includes('ATC did not clear'))) a.atcReply = 'grant'
    })
    assert.equal(requestsOf(sent).length, 2)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
  })

  it('does not start when the ATC program is not connected', () => {
    const ac = makeAircraft(500)
    ac.atc = { connected: false, request: null }
    const engine = makeEngine({ atcFirst: true })
    const messages = new Set<string>()
    const sent = run(engine, ac, 1200, () => messages.add(engine.status.message))

    assert.equal(sent.length, 0, 'nothing is sent anywhere')
    assert.ok([...messages].some((m) => /ATC is not connected/.test(m)), 'it says why it is waiting')
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'skipped')
    assert.match(st.note, /passed/)
    assert.equal(ac.altFt, 34000)
  })

  it('does not ask for a step the weight guard is holding', () => {
    const ac = withAtc()
    ac.weightKg = 200_000
    const engine = makeEngine({ atcFirst: true })
    const sent = run(engine, ac, 1000)
    assert.equal(requestsOf(sent).length, 0)
    assert.match(engine.status.message, /heavier/)
  })

  it('asks for a step down too, when step downs are on', () => {
    const ac = withAtc('grant', 36000)
    const engine = makeEngine({ atcFirst: true, stepDowns: true }, downPlan())
    const sent = run(engine, ac, 1200)
    assert.deepEqual(requestsOf(sent)[0]!.cmd, { type: 'atc-request', altFt: 34000 })
    assert.equal(ac.altFt, 34000)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('Step now goes ahead without asking', () => {
    const ac = withAtc()
    const engine = makeEngine({ atcFirst: true })
    run(engine, ac, 100)
    assert.equal(engine.stepNow(), true)
    const sent = run(engine, ac, 400)
    assert.equal(requestsOf(sent).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
  })

  it('Stop while asking cancels the request and drops the step', () => {
    const ac = withAtc('silent')
    const engine = makeEngine({ atcFirst: true })
    run(engine, ac, 690)
    assert.equal(engine.status.phase, 'asking-atc')

    engine.abort()
    const out = engine.tick(ac.snapshot())
    assert.deepEqual(out, [{ type: 'atc-cancel' }])
    assert.equal(engine.status.steps[0]!.status, 'skipped')
    assert.match(engine.status.steps[0]!.note, /stopped by you/)
  })

  it('does not ask in a dry run', () => {
    const ac = withAtc()
    const engine = makeEngine({ atcFirst: true, live: false })
    const sent = run(engine, ac, 1200)
    assert.equal(sent.length, 0)
    assert.equal(engine.status.steps[0]!.status, 'dry-run')
  })

  it('is off by default', () => {
    const ac = withAtc()
    const engine = makeEngine()
    const sent = run(engine, ac, 1200)
    assert.equal(requestsOf(sent).length, 0)
    assert.equal(engine.status.atcFirst, false)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  describe('with climb anyway (one run: climb when ATC does not work)', () => {
    it('climbs after the second refusal instead of skipping the step, and says so', () => {
      const ac = withAtc('refuse')
      const engine = makeEngine({ atcFirst: true, atcClimbAnyway: true, atcRetryMs: 30_000 })
      const sent = run(engine, ac, 1200)

      assert.equal(requestsOf(sent).length, 2, 'it still asks, twice')
      assert.ok(cancelsOf(sent).length >= 1, 'and closes the open request')
      assert.equal(engine.status.steps[0]!.status, 'done')
      assert.equal(ac.altFt, 36000)
      assert.ok(engine.logs.some((l) => /ATC did not clear FL360.*climbing anyway/.test(l.text)))
    })

    it('climbs when ATC says nothing', () => {
      const ac = withAtc('silent')
      const engine = makeEngine({ atcFirst: true, atcClimbAnyway: true, atcTimeoutMs: 20_000, atcRetryMs: 30_000 })
      const sent = run(engine, ac, 1200)
      assert.equal(requestsOf(sent).length, 2)
      assert.equal(engine.status.steps[0]!.status, 'done')
      assert.equal(ac.altFt, 36000)
    })

    it('climbs when the ATC program cannot be reached, and says so once', () => {
      const ac = makeAircraft(500)
      ac.atc = { connected: false, request: null }
      const engine = makeEngine({ atcFirst: true, atcClimbAnyway: true })
      const sent = run(engine, ac, 1200)

      assert.equal(requestsOf(sent).length, 0, 'there is nobody to ask')
      assert.equal(engine.status.steps[0]!.status, 'done')
      assert.equal(ac.altFt, 36000)
      assert.equal(engine.logs.filter((l) => /not connected.*climbing anyway/.test(l.text)).length, 1)
    })

    it('still asks when the connection comes back before the step point, and uses the answer', () => {
      const ac = makeAircraft(500)
      ac.atc = { connected: false, request: null }
      ac.atcReply = 'grant'
      const engine = makeEngine({ atcFirst: true, atcClimbAnyway: true })
      let ticks = 0
      const sent = run(engine, ac, 1200, (a) => {
        if (++ticks === 690) a.atc = { connected: true, request: null }
      })
      assert.equal(requestsOf(sent).length, 1)
      assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360')))
      assert.equal(engine.status.steps[0]!.status, 'done')
      assert.equal(ac.altFt, 36000)
    })

    it('does not say it climbed anyway when ATC clears the step', () => {
      const ac = withAtc('grant')
      const engine = makeEngine({ atcFirst: true, atcClimbAnyway: true })
      run(engine, ac, 1200)
      assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360')))
      assert.equal(engine.logs.some((l) => /climbing anyway/.test(l.text)), false)
      assert.equal(engine.status.steps[0]!.status, 'done')
    })

    it('does nothing unless Ask BeyondATC first is on, and is off by default', () => {
      assert.equal(makeEngine().status.atcClimbAnyway, false)
      const ac = withAtc('refuse')
      const engine = makeEngine({ atcClimbAnyway: true }) // atcFirst is off: no asking, so nothing to climb anyway about
      const sent = run(engine, ac, 1200)
      assert.equal(requestsOf(sent).length, 0)
      assert.equal(engine.logs.some((l) => /climbing anyway/.test(l.text)), false)
      assert.equal(engine.status.steps[0]!.status, 'done')
    })
  })

  it('warns when ATC was told a level the aircraft then did not reach', () => {
    const ac = withAtc()
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine({ atcFirst: true })
    run(engine, ac, 1600)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360 but the step did not complete')))
  })
})
