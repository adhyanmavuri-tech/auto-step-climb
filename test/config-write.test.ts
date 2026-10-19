import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadAppState, profileFingerprint, saveAppState } from '../src/app-state.ts'
import { saveConfigValues } from '../src/config-write.ts'

function withDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-config-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('saveConfigValues', () => {
  it('creates the file, and the folder it lives in, when there is none', () =>
    withDir((dir) => {
      const file = path.join(dir, 'deep', 'config.json')
      assert.deepEqual(saveConfigValues(file, [{ path: ['simbrief', 'username'], value: 'examplepilot' }]), { ok: true })
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { simbrief: { username: 'examplepilot' } })
    }))

  it('changes one setting and leaves everything else as the user had it', () =>
    withDir((dir) => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(file, JSON.stringify({ simbrief: { username: 'examplepilot', userId: '' }, planFile: 'ofp.json', engine: { leadNm: 3, atcFirst: false } }))
      saveConfigValues(file, [
        { path: ['engine', 'atcFirst'], value: true },
        { path: ['live'], value: true }
      ])
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
        simbrief: { username: 'examplepilot', userId: '' },
        planFile: 'ofp.json',
        engine: { leadNm: 3, atcFirst: true },
        live: true
      })
    }))

  it('replaces something in the way when a section is not an object', () =>
    withDir((dir) => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(file, JSON.stringify({ engine: 5 }))
      saveConfigValues(file, [{ path: ['engine', 'atcFirst'], value: true }])
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { engine: { atcFirst: true } })
    }))

  it('refuses to overwrite a file that is not valid JSON, and says why', () =>
    withDir((dir) => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(file, '{ "simbrief": { "username": "examplepilot" ')
      const result = saveConfigValues(file, [{ path: ['live'], value: true }])
      assert.equal(result.ok, false)
      assert.match(result.ok ? '' : result.reason, /not valid JSON/)
      assert.equal(fs.readFileSync(file, 'utf8'), '{ "simbrief": { "username": "examplepilot" ', 'untouched')
    }))

  it('reads a file saved with a byte order mark', () =>
    withDir((dir) => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(file, '﻿{"planFile":"a.json"}')
      assert.deepEqual(saveConfigValues(file, [{ path: ['live'], value: false }]), { ok: true })
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { planFile: 'a.json', live: false })
    }))

  it('leaves no temporary file behind', () =>
    withDir((dir) => {
      const file = path.join(dir, 'config.json')
      saveConfigValues(file, [{ path: ['live'], value: true }])
      assert.deepEqual(fs.readdirSync(dir), ['config.json'])
    }))
})

describe('app state', () => {
  it('starts fresh when there is no file or it is damaged', () =>
    withDir((dir) => {
      assert.deepEqual(loadAppState(path.join(dir, 'state.json')), { firstRunDone: false, controlTested: {} })
      const bad = path.join(dir, 'bad.json')
      fs.writeFileSync(bad, 'not json')
      assert.deepEqual(loadAppState(bad), { firstRunDone: false, controlTested: {} })
    }))

  it('keeps what was saved, and ignores junk in the file', () =>
    withDir((dir) => {
      const file = path.join(dir, 'state.json')
      assert.equal(saveAppState(file, { firstRunDone: true, controlTested: { A330: 'abc' } }), true)
      assert.deepEqual(loadAppState(file), { firstRunDone: true, controlTested: { A330: 'abc' } })
      fs.writeFileSync(file, JSON.stringify({ firstRunDone: 'yes', controlTested: { A330: 5, B: 'ok' } }))
      assert.deepEqual(loadAppState(file), { firstRunDone: false, controlTested: { B: 'ok' } })
    }))

  it('fingerprints a profile so that any change to it asks for a new control test', () => {
    const a = { name: 'A330', verified: false, knob: { inputEvent: 'AIRLINER_MCU_ALT' } }
    assert.equal(profileFingerprint(a), profileFingerprint({ ...a }))
    assert.notEqual(profileFingerprint(a), profileFingerprint({ ...a, verified: true }))
    assert.match(profileFingerprint(a), /^[0-9a-f]{16}$/)
  })
})
