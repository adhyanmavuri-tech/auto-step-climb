import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { draftKnobProfile, guessTitlePattern } from '../src/draft-profile.ts'
import { parseProfile } from '../src/profile.ts'

/** A slice of the input events the A330 really lists. */
const A330_EVENTS = [
  'AIRLINER_MCU_SPEED',
  'AIRLINER_MCU_SPEED_PUSH',
  'AIRLINER_MCU_SPEED_PULL',
  'AIRLINER_MCU_ALT',
  'AIRLINER_MCU_ALT_PUSH',
  'AIRLINER_MCU_ALT_PULL',
  'AIRLINER_MCU_ALTSELECT',
  'AIRLINER_ALT_PUSH',
  'AIRLINER_AP1_PUSH',
  'AIRLINER_AP2_PUSH',
  'AIRLINER_ATHR_PUSH'
]

describe('draft profile', () => {
  it('finds the A330 ALT rotary, push and pull', () => {
    const { profile, notes } = draftKnobProfile('A330-300 (RR)', A330_EVENTS)
    assert.ok(profile)
    assert.equal(profile.titlePattern, 'A330')
    assert.equal(profile.verified, false)
    assert.deepEqual(profile.knob, { inputEvent: 'AIRLINER_MCU_ALT', upValue: 1, downValue: -1 })
    assert.ok(notes.some((n) => /guesses/.test(n)))
  })

  it('writes something the loader accepts', () => {
    const { profile } = draftKnobProfile('A330-300 (RR)', A330_EVENTS)
    const parsed = parseProfile(profile)
    assert.equal(parsed.control, 'knob')
    assert.equal(parsed.engage.managed.length, 1)
  })

  it('says so when no knob-style events exist', () => {
    const { profile, notes } = draftKnobProfile('Some Aircraft', ['LIGHT_TOGGLE', 'GEAR_DOWN'])
    assert.equal(profile, null)
    assert.match(notes[0]!, /key events, LVars or H-events/)
  })

  it('ignores an ALT push that has no matching pull', () => {
    const { profile } = draftKnobProfile('X', ['SOME_ALT', 'SOME_ALT_PUSH'])
    assert.equal(profile, null)
  })

  it('guesses a title pattern from the model designation', () => {
    assert.equal(guessTitlePattern('A330-300 (RR)'), 'A330')
    assert.equal(guessTitlePattern('FlyByWire Simulations Airbus A380-842'), 'A380')
    assert.equal(guessTitlePattern('Boeing 737-800 Asobo'), 'Boeing')
  })
})
