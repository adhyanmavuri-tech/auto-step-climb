import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { inputEventsUsed, loadProfiles, parseProfile, pickProfile } from '../src/profile.ts'

const profilesDir = path.resolve(import.meta.dirname, '..', 'profiles')
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(profilesDir, file), 'utf8'))

const knobProfile = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Test knob',
  titlePattern: 'TEST',
  control: 'knob',
  simVars: { fcuSelectedFt: 'AUTOPILOT ALTITUDE LOCK VAR', apTargetFt: 'AUTOPILOT ALTITUDE LOCK VAR' },
  knob: { inputEvent: 'ALT', upValue: 1, downValue: -1 },
  engage: { managed: [{ inputEvent: 'ALT_PUSH', value: 1, releaseValue: 0, pulseMs: 200 }], open: [] },
  ...over
})

describe('profiles', () => {
  it('the shipped A330 profile is valid', () => {
    const p = parseProfile(readJson('a330.json'))
    assert.equal(p.control, 'knob')
    assert.equal(p.knob?.inputEvent, 'AIRLINER_MCU_ALT')
    assert.deepEqual(inputEventsUsed(p).sort(), ['AIRLINER_MCU_ALT', 'AIRLINER_MCU_ALT_PULL', 'AIRLINER_MCU_ALT_PUSH'])
  })

  it('the templates are structurally valid examples', () => {
    assert.equal(parseProfile(readJson('_template-knob.json')).control, 'knob')
    assert.equal(parseProfile(readJson('_template-direct.json')).control, 'direct')
  })

  it('only the A330 profile ships marked verified (so Live control does not wait for a Control test); the templates start unverified', () => {
    assert.equal(parseProfile(readJson('a330.json')).verified, true)
    assert.equal(parseProfile(readJson('_template-knob.json')).verified, false)
    assert.equal(parseProfile(readJson('_template-direct.json')).verified, false)
  })

  it('verified defaults to false', () => {
    assert.equal(parseProfile(knobProfile()).verified, false)
    assert.equal(parseProfile(knobProfile({ verified: true })).verified, true)
  })

  it('accepts key events with the target altitude as data on a direct profile', () => {
    const p = parseProfile({
      name: 'Direct',
      titlePattern: 'X',
      control: 'direct',
      simVars: { fcuSelectedFt: 'AUTOPILOT ALTITUDE LOCK VAR', apTargetFt: 'AUTOPILOT ALTITUDE LOCK VAR' },
      setAltitude: { keyEvent: 'AP_ALT_VAR_SET_ENGLISH', data: 'altitudeFt' },
      engage: { managed: [{ keyEvent: 'AP_ALT_HOLD' }] }
    })
    assert.deepEqual(p.setAltitude, { keyEvent: 'AP_ALT_VAR_SET_ENGLISH', data: 'altitudeFt' })
    assert.deepEqual(p.engage.open, [])
  })

  it('rejects the usual mistakes with a clear message', () => {
    assert.throws(() => parseProfile(knobProfile({ control: 'wheel' })), /control must be "knob" or "direct"/)
    assert.throws(() => parseProfile(knobProfile({ engage: { managed: [] } })), /at least one action/)
    assert.throws(() => parseProfile(knobProfile({ engage: { managed: [{ nothing: 1 }] } })), /needs "inputEvent" or "keyEvent"/)
    assert.throws(() => parseProfile(knobProfile({ titlePattern: '(' })), /./)
    assert.throws(() => parseProfile(knobProfile({ knob: { inputEvent: 'ALT', upValue: 'x', downValue: -1 } })), /upValue must be a number/)
    assert.throws(() => parseProfile(knobProfile({ simVars: {} })), /fcuSelectedFt must be a non-empty string/)
    assert.throws(
      () => parseProfile({ ...knobProfile(), control: 'direct', knob: undefined }),
      /setAltitude is required/
    )
  })

  it('loads good files, skips _ files and reports broken ones without stopping', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-profiles-'))
    try {
      fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(knobProfile()))
      fs.writeFileSync(path.join(dir, '_ignored.json'), JSON.stringify(knobProfile({ name: 'Ignored' })))
      fs.writeFileSync(path.join(dir, 'notjson.json'), '{ nope')
      fs.writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify({ name: 'x' }))
      fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a profile')
      const { profiles, errors } = loadProfiles(dir)
      assert.deepEqual(profiles.map((p) => p.name), ['Test knob'])
      assert.equal(errors.length, 2)
      assert.ok(errors.some((e) => e.startsWith('notjson.json')))
      assert.ok(errors.some((e) => e.startsWith('invalid.json')))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing profiles folder instead of throwing', () => {
    const { profiles, errors } = loadProfiles(path.join(os.tmpdir(), 'autostep-does-not-exist'))
    assert.equal(profiles.length, 0)
    assert.equal(errors.length, 1)
  })

  it('picks the profile whose pattern matches, preferring the more specific one', () => {
    const general = parseProfile(knobProfile({ name: 'General', titlePattern: 'A3' }))
    const specific = parseProfile(knobProfile({ name: 'Specific', titlePattern: 'A330' }))
    assert.equal(pickProfile([general, specific], 'A330-300 (RR)')?.name, 'Specific')
    assert.equal(pickProfile([specific, general], 'A320neo')?.name, 'General')
    assert.equal(pickProfile([general, specific], 'Cessna 172'), null)
  })
})
