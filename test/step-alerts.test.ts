import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EngineStatus, StepState, StepStatus } from '../src/engine.ts'
import { StepAlerts } from '../src/step-alerts.ts'
import type { PlannedStep } from '../src/types.ts'

function planned(id: string, fromFt: number, toFt: number): PlannedStep {
  return { id, label: `FIX${id} FL${toFt / 100}`, fromAltFt: fromFt, toAltFt: toFt, trigger: { kind: 'distance', afterNm: 10 }, plannedWeightKg: null }
}

const state = (step: PlannedStep, status: StepStatus, note = ''): StepState => ({ step, status, note })

function status(steps: StepState[], over: Partial<EngineStatus> = {}): EngineStatus {
  return {
    phase: 'waiting',
    message: 'Waiting',
    enabled: true,
    live: true,
    stepDowns: false,
    weightGuard: true,
    heldForWeight: false,
    atcFirst: false,
    atcClimbAnyway: false,
    atcOtherAircraft: false,
    askOnly: false,
    distToNextNm: null,
    crossTrackNm: null,
    cruiseNm: 0,
    alongNm: null,
    route: null,
    steps,
    ...over
  }
}

describe('notes about the steps', () => {
  const up = planned('1', 34_000, 36_000)

  it('says nothing about a plan as it first appears, even with steps already done or skipped in it', () => {
    const alerts = new StepAlerts()
    const behind = planned('0', 32_000, 34_000)
    assert.deepEqual(alerts.update(status([state(behind, 'done'), state(up, 'pending')])), [])
    assert.deepEqual(alerts.update(status([state(behind, 'done'), state(up, 'pending')])), [])
  })

  it('tells a step that starts and one that is complete, each once', () => {
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'pending')]))
    const started = alerts.update(status([state(up, 'active')]))
    assert.equal(started.length, 1)
    assert.equal(started[0]!.title, 'Step climb started')
    assert.match(started[0]!.text, /FIX1 FL360/)
    assert.match(started[0]!.text, /FL360/)
    assert.deepEqual(alerts.update(status([state(up, 'active')])), [], 'the same thing is not said twice')
    const done = alerts.update(status([state(up, 'done', 'reached FL360')]))
    assert.equal(done.length, 1)
    assert.equal(done[0]!.title, 'Step climb complete')
    assert.deepEqual(alerts.update(status([state(up, 'done', 'reached FL360')])), [])
  })

  it('tells a failure and says to check the aircraft, but not a stop you asked for', () => {
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'active')]))
    const failed = alerts.update(status([state(up, 'failed', 'No climb after the climb command (is the autopilot on?)')]))
    assert.equal(failed.length, 1)
    assert.equal(failed[0]!.title, 'Step climb failed')
    assert.match(failed[0]!.text, /autopilot/)
    assert.match(failed[0]!.text, /Check your aircraft/)

    const other = planned('2', 36_000, 38_000)
    const quiet = new StepAlerts()
    quiet.update(status([state(other, 'active')]))
    assert.deepEqual(quiet.update(status([state(other, 'failed', 'stopped by you')])), [])
  })

  it('tells a run that only watches that the step was not flown, and how to change that', () => {
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'pending')], { live: false }))
    const out = alerts.update(status([state(up, 'dry-run', 'would have set FL360')], { live: false }))
    assert.equal(out.length, 1)
    assert.match(out[0]!.title, /Watching only/)
    assert.match(out[0]!.text, /Live control is off/)
    assert.match(out[0]!.text, /Turn it on in Settings/)
  })

  it('says nothing about steps that were already behind or that you skipped, but tells every other skip', () => {
    const behind = planned('b', 34_000, 36_000)
    for (const note of ['passed 120 NM ago', 'already at or above FL360', 'skipped by you', 'stopped by you']) {
      const alerts = new StepAlerts()
      alerts.update(status([state(behind, 'pending')]))
      assert.deepEqual(alerts.update(status([state(behind, 'skipped', note)])), [], note)
    }
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'pending')]))
    const out = alerts.update(status([state(up, 'skipped', 'ATC did not clear FL360 (no answer)')]))
    assert.equal(out.length, 1)
    assert.equal(out[0]!.title, 'Step climb skipped')
    assert.match(out[0]!.text, /ATC did not clear FL360/)
  })

  it('says descent for a step down', () => {
    const down = planned('d', 38_000, 36_000)
    const alerts = new StepAlerts()
    alerts.update(status([state(down, 'pending')]))
    assert.equal(alerts.update(status([state(down, 'active')]))[0]!.title, 'Step descent started')
    assert.equal(alerts.update(status([state(down, 'done')]))[0]!.title, 'Step descent complete')
  })

  it('tells a step held for weight once, in the engine\'s own words, and again for the next step', () => {
    const alerts = new StepAlerts()
    const second = planned('2', 36_000, 38_000)
    const held = (steps: StepState[]): EngineStatus => status(steps, { heldForWeight: true, message: 'Holding FIX1 FL360: 7.5% heavier than the OFP planned (skip it or use Step now to override)' })
    alerts.update(status([state(up, 'pending'), state(second, 'pending')]))
    const first = alerts.update(held([state(up, 'pending'), state(second, 'pending')]))
    assert.equal(first.length, 1)
    assert.match(first[0]!.title, /too heavy/)
    assert.match(first[0]!.text, /7\.5% heavier/)
    assert.deepEqual(alerts.update(held([state(up, 'pending'), state(second, 'pending')])), [], 'still held: not said again')

    // light enough again, then heavy again at the same step: that is news again
    assert.deepEqual(alerts.update(status([state(up, 'pending'), state(second, 'pending')])), [])
    assert.equal(alerts.update(held([state(up, 'pending'), state(second, 'pending')])).length, 1)
  })

  it('says nothing for an aircraft the app does not control, which has its own notes from BeyondATC', () => {
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'pending')], { askOnly: true }))
    assert.deepEqual(alerts.update(status([state(up, 'done', 'reached FL360')], { askOnly: true })), [])
  })

  it('starts again with a new plan: what is already in it is not news', () => {
    const alerts = new StepAlerts()
    alerts.update(status([state(up, 'pending')]))
    const next = planned('9', 36_000, 38_000)
    assert.deepEqual(alerts.update(status([state(next, 'done')])), [])
    assert.deepEqual(alerts.update(status([state(next, 'done')])), [])
  })
})
