import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Phase, StepState } from '../src/engine.ts'
import { fitTip, TIP_MAX, trayStatus } from '../src/tray-status.ts'
import type { TrayInput } from '../src/tray-status.ts'

const step = (label: string, status: StepState['status']): StepState => ({
  step: { id: label, label, fromAltFt: 36000, toAltFt: 38000, trigger: { kind: 'distance', afterNm: 100 }, plannedWeightKg: null },
  status,
  note: ''
})

function input(over: { phase?: Phase; message?: string; enabled?: boolean; steps?: StepState[]; connected?: boolean; hasData?: boolean; aircraftOk?: boolean; mode?: TrayInput['mode']; planError?: string | null } = {}): TrayInput {
  return {
    mode: over.mode ?? 'live',
    sim: { connected: over.connected ?? true, hasData: over.hasData ?? true, aircraftOk: over.aircraftOk ?? true },
    engine: { phase: over.phase ?? 'waiting', message: over.message ?? '32N135W FL380 in 443 NM', enabled: over.enabled ?? true, steps: over.steps ?? [step('32N135W FL380', 'pending')] },
    planError: over.planError ?? null
  }
}

describe('tray status', () => {
  it('is green while it waits for a step, and says how far', () => {
    const s = trayStatus(input())
    assert.equal(s.level, 'ok')
    assert.equal(s.line, '32N135W FL380 in 443 NM')
    assert.equal(s.tip, 'Auto Step Climb (Live): 32N135W FL380 in 443 NM')
    assert.equal(s.title, 'Auto Step Climb - Live')
  })

  it('is cyan from STEP AHEAD until the step is done', () => {
    for (const phase of ['armed', 'setting-fcu', 'asking-atc', 'engaging', 'climbing', 'descending', 'restoring'] as const) {
      assert.equal(trayStatus(input({ phase })).level, 'busy', phase)
    }
  })

  it('is amber when the sim is not there, has sent nothing yet, or has no supported aircraft', () => {
    assert.deepEqual(
      [trayStatus(input({ connected: false })).line, trayStatus(input({ hasData: false })).line, trayStatus(input({ aircraftOk: false })).line],
      ['Waiting for the sim', 'Waiting for aircraft data', 'No supported aircraft loaded']
    )
    for (const over of [{ connected: false }, { hasData: false }, { aircraftOk: false }]) assert.equal(trayStatus(input(over)).level, 'attention')
  })

  it('is amber when it waits for you to confirm a step: the one time somebody has to be there', () => {
    const s = trayStatus(input({ phase: 'confirming', message: 'Press Confirm to climb to FL380' }))
    assert.equal(s.level, 'attention')
    assert.equal(s.line, 'Press Confirm to climb to FL380')
  })

  it('is grey when the automation is switched off', () => {
    const s = trayStatus(input({ enabled: false }))
    assert.equal(s.level, 'off')
    assert.match(s.line, /Switched off/)
  })

  it('is red once a step has failed, and says which', () => {
    const s = trayStatus(input({ steps: [step('32N135W FL380', 'failed'), step('15N155W FL400', 'pending')] }))
    assert.equal(s.level, 'problem')
    assert.equal(s.line, 'A step failed: 32N135W FL380')
  })

  it('skipped steps are not failures', () => {
    assert.equal(trayStatus(input({ steps: [step('32N135W FL380', 'skipped')] })).level, 'ok')
  })

  it('shows a step in progress as cyan even when an earlier step failed, and goes back to red after', () => {
    const steps = [step('A FL380', 'failed'), step('B FL400', 'active')]
    assert.equal(trayStatus(input({ steps, phase: 'climbing', message: 'Climbing to FL400' })).level, 'busy')
    assert.equal(trayStatus(input({ steps, phase: 'waiting' })).level, 'problem')
  })

  it('a missing plan is amber', () => {
    const s = trayStatus(input({ steps: [], planError: 'No flight plan: set simbrief.username in config.json' }))
    assert.equal(s.level, 'attention')
  })

  it('the sim being away outranks everything else', () => {
    assert.equal(trayStatus(input({ connected: false, enabled: false, steps: [step('A FL380', 'failed')] })).level, 'attention')
  })

  it('says why when the app is closing because the aircraft is not supported, whatever else is going on', () => {
    const s = trayStatus({ ...input(), closing: 'FlyByWire A320neo is not supported' })
    assert.equal(s.level, 'attention')
    assert.equal(s.line, 'Closing: FlyByWire A320neo is not supported')
    assert.match(s.tip, /^Auto Step Climb \(Live\): Closing: /)
    assert.equal(trayStatus({ ...input(), closing: null }).level, 'ok', 'null means it is not closing')
  })

  it('names the mode in the hover text, so a preview or a dry run is never mistaken for the real thing', () => {
    assert.match(trayStatus(input({ mode: 'dry-run' })).tip, /^Auto Step Climb \(Watching only\): /)
    assert.match(trayStatus(input({ mode: 'preview' })).tip, /^Auto Step Climb \(Preview\): /)
    assert.match(trayStatus(input({ mode: 'demo' })).tip, /^Auto Step Climb \(Demo\): /)
  })

  it('keeps the hover text to what Windows shows', () => {
    const long = trayStatus(input({ message: 'Waiting for stable cruise before the 15N155W step to FL400 at the next fix' }))
    assert.ok(long.tip.length <= TIP_MAX, `${long.tip.length} characters`)
    assert.ok(long.tip.endsWith('...'))
    assert.equal(long.line, 'Waiting for stable cruise before the 15N155W step to FL400 at the next fix', 'the menu line is not cut')
    assert.equal(fitTip('short'), 'short')
    assert.equal(fitTip('a'.repeat(TIP_MAX)), 'a'.repeat(TIP_MAX))
    assert.equal(fitTip('line one\nline two').includes('\n'), false)
  })
})
