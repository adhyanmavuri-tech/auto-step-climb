import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planCommand } from '../src/actions.ts'
import { parseProfile } from '../src/profile.ts'

const simVars = { fcuSelectedFt: 'AUTOPILOT ALTITUDE LOCK VAR', apTargetFt: 'AUTOPILOT ALTITUDE LOCK VAR' }

const a330 = parseProfile({
  name: 'A330',
  titlePattern: 'A330',
  control: 'knob',
  simVars,
  knob: { inputEvent: 'AIRLINER_MCU_ALT', upValue: 1, downValue: -1 },
  engage: {
    managed: [{ inputEvent: 'AIRLINER_MCU_ALT_PUSH', value: 1, releaseValue: 0, pulseMs: 200 }],
    open: [{ inputEvent: 'AIRLINER_MCU_ALT_PULL', value: 1, releaseValue: 0, pulseMs: 200 }]
  }
})

const direct = parseProfile({
  name: 'Direct',
  titlePattern: 'X',
  control: 'direct',
  simVars,
  setAltitude: { keyEvent: 'AP_ALT_VAR_SET_ENGLISH', data: 'altitudeFt' },
  engage: { managed: [{ keyEvent: 'FLIGHT_LEVEL_CHANGE_ON' }, { keyEvent: 'AP_ALT_HOLD', data: 1 }] }
})

describe('planCommand', () => {
  it('turns an FCU click into the knob event with the profile value', () => {
    assert.deepEqual(planCommand(a330, { type: 'fcu-click', dir: 1 }), [{ kind: 'input', name: 'AIRLINER_MCU_ALT', value: 1, delayMs: 0 }])
    assert.deepEqual(planCommand(a330, { type: 'fcu-click', dir: -1 }), [{ kind: 'input', name: 'AIRLINER_MCU_ALT', value: -1, delayMs: 0 }])
  })

  it('presses and releases the push button', () => {
    assert.deepEqual(planCommand(a330, { type: 'engage', mode: 'managed' }), [
      { kind: 'input', name: 'AIRLINER_MCU_ALT_PUSH', value: 1, delayMs: 0 },
      { kind: 'input', name: 'AIRLINER_MCU_ALT_PUSH', value: 0, delayMs: 200 }
    ])
  })

  it('uses the pull event for an open climb', () => {
    const names = planCommand(a330, { type: 'engage', mode: 'open' }).map((p) => p.name)
    assert.deepEqual(names, ['AIRLINER_MCU_ALT_PULL', 'AIRLINER_MCU_ALT_PULL'])
  })

  it('passes the target altitude to a key event', () => {
    assert.deepEqual(planCommand(direct, { type: 'set-altitude', ft: 36000 }), [
      { kind: 'key', name: 'AP_ALT_VAR_SET_ENGLISH', data: 36000, delayMs: 0 }
    ])
  })

  it('can pass the target altitude as an input event value', () => {
    const p = parseProfile({
      name: 'IE direct',
      titlePattern: 'X',
      control: 'direct',
      simVars,
      setAltitude: { inputEvent: 'SET_ALT', value: 'altitudeFt' },
      engage: { managed: [{ inputEvent: 'GO', value: 1 }] }
    })
    assert.deepEqual(planCommand(p, { type: 'set-altitude', ft: 37000 }), [{ kind: 'input', name: 'SET_ALT', value: 37000, delayMs: 0 }])
  })

  it('spaces out several actions so they do not land in one frame', () => {
    assert.deepEqual(planCommand(direct, { type: 'engage', mode: 'managed' }), [
      { kind: 'key', name: 'FLIGHT_LEVEL_CHANGE_ON', data: 0, delayMs: 0 },
      { kind: 'key', name: 'AP_ALT_HOLD', data: 1, delayMs: 250 }
    ])
  })

  it('does nothing for a command the aircraft cannot do', () => {
    assert.deepEqual(planCommand(direct, { type: 'fcu-click', dir: 1 }), [])
    assert.deepEqual(planCommand(a330, { type: 'set-altitude', ft: 36000 }), [])
    assert.deepEqual(planCommand(direct, { type: 'engage', mode: 'open' }), [])
  })
})
