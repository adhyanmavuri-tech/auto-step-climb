import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manualPlan } from '../src/plan.ts'
import { STEP_ALONG_NM, clicksOf, engagesOf, makeAircraft, makeEngine, run, setsOf } from './helpers.ts'

describe('step climb engine', () => {
  it('flies a planned step: FCU first, then the managed climb, at the step fix', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    const sent = run(engine, ac, 1200)

    const first = sent[0]!
    assert.ok(first.alongNm >= STEP_ALONG_NM - 0.01 && first.alongNm < STEP_ALONG_NM + 0.5, `first command at ${first.alongNm}, fix at ${STEP_ALONG_NM}`)
    assert.equal(clicksOf(sent).length, 20)
    assert.ok(clicksOf(sent).every((s) => s.cmd.type === 'fcu-click' && s.cmd.dir === 1))
    assert.deepEqual(engagesOf(sent), [{ type: 'engage', mode: 'managed' }])
    assert.equal(sent[sent.length - 1]!.cmd.type, 'engage', 'the climb starts after all the clicks')
    assert.equal(ac.altFt, 36000)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('in dry-run mode decides and logs but sends nothing', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ live: false })
    const sent = run(engine, ac, 1200)
    assert.equal(sent.length, 0)
    assert.equal(engine.status.steps[0]!.status, 'dry-run')
    assert.ok(engine.logs.some((l) => l.text.includes('[watching only]')))
    assert.equal(ac.fcuSelectedFt, 34000)
  })

  it('holds a heavy aircraft, then goes once it is light enough', () => {
    const ac = makeAircraft()
    ac.weightKg = 200_000 // plan says 184,000 at FIX2, +3% = 189,520
    const engine = makeEngine()
    assert.equal(run(engine, ac, 1000).length, 0)
    assert.match(engine.status.message, /heavier/)
    assert.equal(engine.status.steps[0]!.status, 'pending')

    ac.weightKg = 180_000
    run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
  })

  it('stays quiet while off the planned route, then goes when back on it', () => {
    const ac = makeAircraft()
    ac.offsetNm = 80
    const engine = makeEngine()
    assert.equal(run(engine, ac, 800).length, 0)
    assert.match(engine.status.message, /Off the planned route/)

    ac.offsetNm = 0
    run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('skips a step whose fix is already well behind', () => {
    const ac = makeAircraft(700) // 100 NM past FIX2
    const engine = makeEngine()
    assert.equal(run(engine, ac, 200).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'skipped')
    assert.match(engine.status.steps[0]!.note, /passed/)
  })

  it('skips a step the aircraft is already at or above', () => {
    const ac = makeAircraft(500, 36000)
    const engine = makeEngine()
    assert.equal(run(engine, ac, 800).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'skipped')
    assert.match(engine.status.steps[0]!.note, /already at or above/)
  })

  it('does nothing below cruise altitudes', () => {
    const ac = makeAircraft(500, 15_000)
    const engine = makeEngine()
    assert.equal(run(engine, ac, 900).length, 0)
    assert.match(engine.status.message, /stable cruise/)
  })

  it('can be tested low down once the cruise floor is lowered, and not before', () => {
    const plan = () => manualPlan([{ afterNm: 2, toFl: 60 }])

    const refused = makeAircraft(0, 4000)
    const idle = makeEngine({}, plan())
    assert.equal(run(idle, refused, 400).length, 0, 'the default cruise floor (20,000 ft) holds it back')
    assert.match(idle.status.message, /stable cruise/)

    const ac = makeAircraft(0, 4000)
    const engine = makeEngine({ minCruiseAltFt: 2000 }, plan())
    run(engine, ac, 500)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 6000)
  })

  it('waits for confirmation when confirmEachStep is on', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ confirmEachStep: true })
    assert.equal(run(engine, ac, 800).length, 0)
    assert.equal(engine.status.phase, 'confirming')

    engine.confirm()
    assert.ok(run(engine, ac, 200).length > 0)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('compensates for a knob that turns the wrong way', () => {
    const ac = makeAircraft()
    ac.knobInverted = true
    const engine = makeEngine()
    run(engine, ac, 1200)
    assert.equal(ac.fcuSelectedFt, 36000)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.ok(engine.logs.some((l) => /opposite way/.test(l.text)))
  })

  it('gives up cleanly when the knob does not respond', () => {
    const ac = makeAircraft()
    ac.knobResponds = false
    const engine = makeEngine()
    const sent = run(engine, ac, 900)
    assert.equal(engagesOf(sent).length, 0, 'never starts a climb without a confirmed FCU altitude')
    assert.equal(clicksOf(sent).length, 3)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.match(engine.status.steps[0]!.note, /did not respond/)
  })

  it('stops instead of hunting when the FCU ring step cannot land on the target', () => {
    const ac = makeAircraft(500, 34100) // FCU ring on 1000 ft, FCU at 34,100: FL360 is not a multiple away
    ac.knobStepFt = 1000
    const engine = makeEngine()
    const sent = run(engine, ac, 1200)
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'failed')
    assert.match(st.note, /can't land on FL360/)
    assert.equal(engagesOf(sent).length, 0, 'no climb is started without the exact altitude')
    assert.equal(ac.fcuSelectedFt, 34100, 'the FCU is put back where it was')
    assert.ok(clicksOf(sent).length <= 6, `only a few clicks, not ${clicksOf(sent).length}`)
  })

  it('works with a 1000 ft ring when the target is a multiple of it', () => {
    const ac = makeAircraft()
    ac.knobStepFt = 1000
    const engine = makeEngine()
    const sent = run(engine, ac, 1200)
    assert.equal(clicksOf(sent).length, 2)
    assert.equal(ac.altFt, 36000)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('falls back to an open climb when the managed climb starts nothing', () => {
    const ac = makeAircraft()
    ac.pushWorks = false
    const engine = makeEngine()
    const sent = run(engine, ac, 1400)
    assert.deepEqual(engagesOf(sent), [
      { type: 'engage', mode: 'managed' },
      { type: 'engage', mode: 'open' }
    ])
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
  })

  it('puts the FCU back when neither climb mode works', () => {
    const ac = makeAircraft()
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine()
    const sent = run(engine, ac, 1600)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.equal(ac.fcuSelectedFt, 34000)
    assert.equal(ac.altFt, 34000)
    assert.equal(clicksOf(sent).length, 40, '20 clicks up, 20 back down')
  })

  it('levels off if the climb stalls part-way', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 1200, (a) => {
      if (a.altFt > 34_500) a.canClimb = false
    })
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'failed')
    assert.match(st.note, /stalled/)
    assert.equal(ac.fcuSelectedFt, Math.ceil(ac.altFt / 100) * 100)
  })

  it('works from distance alone with a manual plan', () => {
    const ac = makeAircraft(0)
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }]))
    run(engine, ac, 900)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
  })

  it('counts distance from positions, so time acceleration does not delay a distance step', () => {
    const ac = makeAircraft(0)
    ac.rate = 8
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }]))
    const sent = run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
    // 60 s of stable cruise at 8x is about 64 NM, so it starts there. Counting speed x clock time
    // would have waited for 50 NM at 1x, about 400 NM of flying.
    assert.ok(sent[0]!.alongNm < 100, `started at ${sent[0]!.alongNm} NM`)
  })

  it('does not count time while the sim is paused', () => {
    const ac = makeAircraft(0)
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }]))
    ac.rate = 0 // paused: the clock runs and the ground speed still reads 480 kt
    assert.equal(run(engine, ac, 1800).length, 0)
    assert.ok(engine.status.cruiseNm < 1, `counted ${engine.status.cruiseNm} NM while paused`)
    assert.equal(engine.status.steps[0]!.status, 'pending')

    ac.rate = 1
    run(engine, ac, 600)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('ignores a jump in position, such as a slew or a flight restart', () => {
    const ac = makeAircraft(0)
    const engine = makeEngine({}, manualPlan([{ afterNm: 50, toFl: 360 }]))
    run(engine, ac, 90) // about 12 NM
    ac.alongNm += 600
    run(engine, ac, 10)
    assert.ok(engine.status.cruiseNm < 30, `counted ${engine.status.cruiseNm} NM`)
    assert.equal(engine.status.steps[0]!.status, 'pending')
  })

  it('ignores an unsupported aircraft', () => {
    const ac = makeAircraft()
    ac.aircraftOk = false
    ac.title = 'Cessna 172'
    const engine = makeEngine()
    assert.equal(run(engine, ac, 900).length, 0)
    assert.match(engine.status.message, /Unsupported aircraft: Cessna 172/)
  })

  it('marks the active step failed if the sim disappears mid-step', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 760)
    assert.equal(engine.status.phase, 'setting-fcu')
    assert.deepEqual(engine.tick(null), [])
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.match(engine.status.steps[0]!.note, /lost the connection/)
  })

  it('Step now starts the next step ahead of its fix', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 100)
    assert.equal(engine.stepNow(), true)
    const sent = run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.ok(sent[0]!.alongNm < STEP_ALONG_NM - 50, `started at ${sent[0]!.alongNm} NM, the fix is at ${STEP_ALONG_NM}`)
  })

  it('skipNext marks the step skipped and sends nothing', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 100)
    engine.skipNext()
    assert.equal(run(engine, ac, 900).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'skipped')
  })

  it('abort stops sending commands', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 760)
    assert.equal(engine.status.phase, 'setting-fcu')
    engine.abort()
    assert.equal(run(engine, ac, 100).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.match(engine.status.steps[0]!.note, /stopped by you/)
  })

  it('does not act while switched off, and a stale manual trigger does not survive it', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ enabled: false })
    engine.stepNow()
    assert.equal(run(engine, ac, 100).length, 0)
    engine.setOptions({ enabled: true })
    // The trigger was cleared while disabled, so the engine waits for the fix (about 80 NM away).
    assert.equal(run(engine, ac, 50).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'pending')
  })
})

describe('aircraft with a direct set-altitude control', () => {
  it('sets the altitude in one command, then starts the climb', () => {
    const ac = makeAircraft()
    ac.control = 'direct'
    const engine = makeEngine()
    const sent = run(engine, ac, 1200)
    assert.deepEqual(setsOf(sent), [{ type: 'set-altitude', ft: 36000 }])
    assert.equal(clicksOf(sent).length, 0)
    assert.deepEqual(engagesOf(sent), [{ type: 'engage', mode: 'managed' }])
    assert.equal(ac.altFt, 36000)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('accepts an altitude that lands a little off, as many autopilots round it', () => {
    const ac = makeAircraft()
    ac.control = 'direct'
    ac.directError = 20
    const engine = makeEngine()
    run(engine, ac, 1200)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('gives up when the altitude never moves, without starting a climb', () => {
    const ac = makeAircraft()
    ac.control = 'direct'
    ac.knobResponds = false
    const engine = makeEngine()
    const sent = run(engine, ac, 900)
    assert.equal(setsOf(sent).length, 3)
    assert.equal(engagesOf(sent).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'failed')
    assert.match(engine.status.steps[0]!.note, /did not respond to 3 set-altitude/)
  })

  it('sets the altitude back when no climb mode works', () => {
    const ac = makeAircraft()
    ac.control = 'direct'
    ac.pushWorks = false
    ac.pullWorks = false
    const engine = makeEngine()
    const sent = run(engine, ac, 1600)
    assert.deepEqual(setsOf(sent), [
      { type: 'set-altitude', ft: 36000 },
      { type: 'set-altitude', ft: 34000 }
    ])
    assert.equal(ac.fcuSelectedFt, 34000)
    assert.equal(engine.status.steps[0]!.status, 'failed')
  })
})

describe('unverified controls', () => {
  it('holds in live mode until the control has been verified, then goes', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ controlReady: false })
    assert.equal(run(engine, ac, 800).length, 0)
    assert.match(engine.status.message, /Control test/)
    assert.equal(engine.status.steps[0]!.status, 'pending')

    engine.setOptions({ controlReady: true })
    run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('does not get in the way of a dry run', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ live: false, controlReady: false })
    run(engine, ac, 1200)
    assert.equal(engine.status.steps[0]!.status, 'dry-run')
  })
})
