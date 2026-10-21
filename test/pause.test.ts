import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { StepClimbEngine } from '../src/engine.ts'
import type { FakeAircraft } from '../src/fake-sim.ts'
import { PauseWatch } from '../src/pause-watch.ts'
import type { Snapshot } from '../src/types.ts'
import { STEP_ALONG_NM, engagesOf, makeAircraft, makeEngine, run } from './helpers.ts'
import type { Sent } from './helpers.ts'

function reading(t: number, lon: number, over: Partial<Snapshot> = {}): Snapshot {
  return {
    t,
    title: 'A330-300 (RR)',
    aircraftOk: true,
    onGround: false,
    lat: 0,
    lon,
    altFt: 36_000,
    vsFpm: 0,
    mach: 0.82,
    gsKt: 480,
    weightKg: 190_000,
    fcuSelectedFt: 36_000,
    apTargetFt: 36_000,
    control: 'knob',
    ...over
  }
}

describe('telling that the sim is paused', () => {
  it('does not call an aircraft that is flying paused', () => {
    const watch = new PauseWatch()
    for (let i = 0; i < 20; i++) assert.equal(watch.mark(reading(i * 1000, 1 + i * 0.002))?.simPaused, undefined, `reading ${i}`)
  })

  it('calls an aircraft that stands still in the air paused, until it is seen to move again', () => {
    const watch = new PauseWatch()
    assert.equal(watch.mark(reading(0, 1))?.simPaused, undefined, 'the first reading shows nothing')
    assert.equal(watch.mark(reading(1000, 1))?.simPaused, true)
    assert.equal(watch.mark(reading(2000, 1))?.simPaused, true)
    assert.equal(watch.mark(reading(3000, 1.002))?.simPaused, undefined, 'moving again')
  })

  it('never calls a parked aircraft paused', () => {
    const watch = new PauseWatch()
    for (let i = 0; i < 5; i++) assert.equal(watch.mark(reading(i * 1000, 1, { onGround: true, gsKt: 0, altFt: 80 }))?.simPaused, undefined)
  })

  it('learns nothing from two readings in the same moment, and keeps what it said', () => {
    const watch = new PauseWatch()
    watch.mark(reading(0, 1))
    assert.equal(watch.mark(reading(100, 1))?.simPaused, undefined, 'the sim may not have drawn a new frame yet')
    assert.equal(watch.mark(reading(1000, 1))?.simPaused, true)
    assert.equal(watch.mark(reading(1100, 1))?.simPaused, true, 'too close to tell: the pause stays')
  })

  it('forgets everything when there is no reading, and leaves a reading alone when it says nothing', () => {
    const watch = new PauseWatch()
    watch.mark(reading(0, 1))
    assert.equal(watch.mark(reading(1000, 1))?.simPaused, true)
    assert.equal(watch.mark(null), null)
    assert.equal(watch.mark(reading(2000, 1))?.simPaused, undefined, 'a new start')

    const moving = reading(3000, 1.5)
    assert.equal(watch.mark(moving), moving, 'the same reading comes back, untouched')
    const stillOne = reading(4000, 1.5)
    const marked = watch.mark(stillOne)
    assert.equal(marked?.simPaused, true)
    assert.equal(stillOne.simPaused, undefined, 'the reading that was passed in is not changed')
  })
})

/** Like run(), but every reading goes through the pause watch first, as it does in the core. */
function runWatched(engine: StepClimbEngine, ac: FakeAircraft, watch: PauseWatch, seconds: number): Sent[] {
  const sent: Sent[] = []
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 1000) {
    for (const cmd of engine.tick(watch.mark(ac.snapshot()))) {
      ac.execute(cmd)
      sent.push({ t: ac.t, alongNm: ac.alongNm, cmd })
    }
    ac.advance(1000)
  }
  return sent
}

/** Flies until the engine is in the given phase, and returns what it sent on the way. */
function flyUntil(engine: StepClimbEngine, ac: FakeAircraft, watch: PauseWatch, phase: string): Sent[] {
  const sent: Sent[] = []
  for (let i = 0; i < 2000 && engine.status.phase !== phase; i++) sent.push(...runWatched(engine, ac, watch, 1))
  assert.equal(engine.status.phase, phase, `never reached ${phase}`)
  return sent
}

describe('a pause in the middle of a step', () => {
  it('without the pause being known, the step is given up on (what used to happen)', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    const sent: Sent[] = []
    for (let i = 0; i < 2000 && engine.status.phase !== 'engaging'; i++) sent.push(...run(engine, ac, 1))
    assert.equal(engine.status.phase, 'engaging')
    ac.rate = 0
    run(engine, ac, 180)
    ac.rate = 1
    run(engine, ac, 300)
    assert.equal(engine.status.steps[0]!.status, 'failed', 'the timers ran out while the sim stood still')
  })

  it('carries on afterwards when the climb command was sent just before the pause', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    const watch = new PauseWatch()
    const sent = flyUntil(engine, ac, watch, 'engaging')

    ac.rate = 0
    const during = runWatched(engine, ac, watch, 180)
    assert.equal(during.length, 0, 'nothing is sent into a paused sim')
    assert.equal(engine.status.phase, 'engaging')
    assert.match(engine.status.message, /paused/)
    assert.equal(engine.status.steps[0]!.status, 'active', 'the step is still being flown')

    ac.rate = 1
    sent.push(...runWatched(engine, ac, watch, 400))
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36_000)
    assert.deepEqual(engagesOf(sent), [{ type: 'engage', mode: 'managed' }], 'no second try, no open climb')
  })

  it('carries on afterwards when the FCU was being set', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    const watch = new PauseWatch()
    const sent = flyUntil(engine, ac, watch, 'setting-fcu')
    sent.push(...runWatched(engine, ac, watch, 5)) // a few clicks in

    ac.rate = 0
    // The reading just before the pause still looks normal, so one more click may go out; after that, nothing.
    const during = runWatched(engine, ac, watch, 180)
    assert.ok(during.length <= 1, `${during.length} commands went out during the pause`)
    assert.equal(engine.status.phase, 'setting-fcu')

    ac.rate = 1
    sent.push(...runWatched(engine, ac, watch, 400))
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36_000)
  })

  it('starts nothing while paused at the step point, and starts it once the sim runs again', () => {
    const ac = makeAircraft(STEP_ALONG_NM + 0.1)
    const engine = makeEngine()
    const watch = new PauseWatch()
    ac.rate = 0
    assert.equal(runWatched(engine, ac, watch, 300).length, 0, 'five minutes of pause, and not one command')
    assert.equal(engine.status.steps[0]!.status, 'pending')

    ac.rate = 1
    runWatched(engine, ac, watch, 400)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36_000)
  })

  it('leaves everything else alone: a reading that is never marked behaves as before', () => {
    const ac = makeAircraft()
    const engine = makeEngine()
    run(engine, ac, 1200)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })
})
