import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildReport, redact } from '../src/report.ts'
import type { ReportEnv, ReportState } from '../src/report.ts'
import { issuesUrl } from '../src/support.ts'

const NOW = Date.UTC(2026, 9, 17, 12, 30, 0)

const ENV: ReportEnv = {
  os: 'Windows 11 (10.0.26200), x64',
  electron: '31.7.7',
  node: '20.18.0',
  installed: true,
  uptimeSec: 3 * 3600 + 12 * 60,
  userName: 'Jane Pilotson',
  homeDir: 'C:\\Users\\Jane Pilotson',
  now: NOW
}

/** What the window shows, mid-flight, with the person's name in a few places it should not stay. */
function state(over: Partial<ReportState> = {}): ReportState {
  return {
    app: { version: '0.9.0', mode: 'live', host: 'app', startWithWindows: true, confirmEachStep: false },
    sim: {
      kind: 'simconnect',
      connected: true,
      dataAgeMs: 400,
      title: 'A330-300 iniBuilds',
      aircraftOk: true,
      profile: { name: 'iniBuilds A330 (MSFS 2024)', verified: false, control: 'knob', tested: true }
    },
    aircraft: { altFt: 36000, vsFpm: 0, mach: 0.82, gsKt: 480, weightKg: 188_400, fcuSelectedFt: 36000, apTargetFt: 36000, onGround: false },
    engine: {
      phase: 'waiting',
      message: 'ARKIN FL380 in 120 NM',
      enabled: true,
      live: true,
      stepDowns: false,
      atcFirst: true,
      distToNextNm: 120.34,
      crossTrackNm: 0.3,
      steps: [
        { step: { label: 'ARKIN FL370', fromAltFt: 35000, toAltFt: 37000 }, status: 'done', note: '' },
        { step: { label: 'KOMAK FL390', fromAltFt: 37000, toAltFt: 39000 }, status: 'skipped', note: 'ATC did not clear it' }
      ]
    },
    atc: { enabled: true, connected: true, autoRespond: true, request: { altFt: 39000, status: 'refused', note: 'unable' } },
    plan: { source: 'simbrief', edited: false, origin: 'EGLL', destination: 'KJFK', generatedAt: '2026-10-17T10:00:00.000Z' },
    planWarning: null,
    planError: null,
    settings: { simbriefUsername: 'examplepilot', simbriefUserId: false, live: true, confirmEachStep: false, openWindowAtAirport: true },
    launch: { phase: 'launched', place: { icao: 'EGLL', name: 'London Heathrow Airport', nm: 0.1 } },
    logs: [
      { at: NOW - 60_000, level: 'info', text: 'SimBrief username set to examplepilot' },
      { at: NOW - 30_000, level: 'warn', text: 'Could not read C:\\Users\\Jane Pilotson\\AppData\\Roaming\\Auto Step Climb\\config.json' },
      { at: NOW - 1_000, level: 'error', text: 'Step KOMAK FL390 skipped' }
    ],
    ...over
  }
}

describe('the bug report', () => {
  it('says what the app was doing, in words a maintainer can use', () => {
    const text = buildReport(state(), ENV)
    for (const part of [
      'AUTO STEP CLIMB: REPORT',
      'Nothing was sent anywhere',
      '0.9.0 (installed app); Electron 31.7.7, Node 20.18.0',
      'Windows 11 (10.0.26200), x64',
      '2026-10-17 12:30:00',
      '3 h 12 min',
      'LIVE (the app operates the FCU)',
      'connected, last reading 0.4 s ago',
      '"A330-300 iniBuilds", supported: yes',
      'iniBuilds A330 (MSFS 2024); verified: no; control test passed: yes; knob controls',
      '36,000 ft, 0 fpm, Mach 0.82, 480 kt, 188.4 t, FCU FL360, AP target FL360, airborne',
      'launched, at EGLL (London Heathrow Airport)',
      'confirm each step: off; step downs: off; ask BeyondATC: on; open window at airport: on',
      'connected; auto respond: on; last request FL390: refused (unable)',
      'simbrief, EGLL to KJFK, generated 2026-10-17T10:00:00.000Z; steps edited by hand: no',
      '1. ARKIN FL370 (FL350 to FL370): done',
      '2. KOMAK FL390 (FL370 to FL390): skipped (ATC did not clear it)',
      'waiting: ARKIN FL380 in 120 NM',
      '120.3 NM away, 0.3 NM off the route',
      'LOG (the newest 3 lines, UTC, oldest first)',
      '2026-10-17 12:29:59 ERROR Step KOMAK FL390 skipped'
    ]) {
      assert.ok(text.includes(part), `missing: ${part}\n\n${text}`)
    }
  })

  it('blanks out the person: SimBrief name, Windows user name and the folders under it', () => {
    const text = buildReport(state(), ENV)
    assert.doesNotMatch(text, /examplepilot/i)
    assert.doesNotMatch(text, /Jane/i)
    assert.doesNotMatch(text, /Pilotson/i)
    assert.match(text, /SimBrief username set to <SimBrief username>/)
    assert.match(text, /Could not read %USERPROFILE%\\AppData\\Roaming\\Auto Step Climb\\config\.json/)
  })

  it('blanks out the name whatever its case, and the home folder with forward slashes too', () => {
    const out = redact('User JANE PILOTSON, C:/Users/jane pilotson/x, id 123456', { userName: 'Jane Pilotson', homeDir: 'C:\\Users\\Jane Pilotson' }, { simbriefUserId: '123456' })
    assert.equal(out, 'User <Windows user>, %USERPROFILE%/x, id <SimBrief ID>')
  })

  it('leaves names of one or two characters alone, because blanking them out would wreck the text', () => {
    assert.equal(redact('ab abc', {}, { simbriefUsername: 'ab' }), 'ab abc')
    assert.equal(redact('ab abc', { userName: 'a' }, {}), 'ab abc')
  })

  it('takes the names to blank out from the caller when it knows more than the window shows (the user ID)', () => {
    const s = state({ logs: [{ at: NOW, level: 'info', text: 'asked for userid=987654' }] })
    const text = buildReport(s, ENV, { secrets: { simbriefUsername: 'examplepilot', simbriefUserId: '987654' } })
    assert.match(text, /asked for userid=<SimBrief ID>/)
  })

  it('copes with nothing known: no sim, no plan, no settings, no log', () => {
    const text = buildReport({ app: { version: '0.9.0', mode: 'dry-run', host: 'cli' } }, { os: 'Windows', now: NOW })
    assert.match(text, /Watching only \(nothing is sent to the aircraft\)/)
    assert.match(text, /not connected/)
    assert.match(text, /none loaded/)
    assert.match(text, /no flight plan loaded/)
    assert.match(text, /\(nothing logged yet\)/)
    assert.doesNotMatch(text, /undefined|NaN|null/)
  })

  it('says when it was run from the source folder, and what a simulated run is', () => {
    const text = buildReport(state({ app: { version: '0.9.0', mode: 'preview' }, sim: { kind: 'demo', connected: true, title: 'A330 (PREVIEW)', aircraftOk: true } }), { ...ENV, installed: false })
    assert.match(text, /run from the source folder/)
    assert.match(text, /Preview \(a simulated aircraft flying the plan\)/)
    assert.match(text, /simulated \(no sim\)/)
  })

  it('keeps only the newest lines, and cuts a very long one', () => {
    const logs = Array.from({ length: 150 }, (_, i) => ({ at: NOW + i * 1000, level: 'info', text: i === 149 ? 'x'.repeat(2000) : `line ${i}` }))
    const text = buildReport(state({ logs }), ENV)
    assert.match(text, /LOG \(the newest 100 lines/)
    assert.ok(!text.includes('line 49\n') && text.includes('line 50\n'), 'lines 50 to 148 are in, 0 to 49 are out')
    assert.ok(text.length < 20_000, `the report is ${text.length} characters`)
    assert.match(text, /x{400}\.\.\./)
    const five = buildReport(state({ logs }), ENV, { logLines: 5 })
    assert.equal(five.split('\n').filter((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /.test(l)).length, 5)
  })
})

describe('where reports go', () => {
  it('opens only a GitHub address, and nothing while none is set', () => {
    assert.equal(issuesUrl(''), '')
    assert.equal(issuesUrl('https://github.com/someone/auto-step-climb/issues/new/choose'), 'https://github.com/someone/auto-step-climb/issues/new/choose')
    assert.equal(issuesUrl('https://github.com/someone/auto-step-climb'), 'https://github.com/someone/auto-step-climb')
    for (const bad of ['http://github.com/a/b', 'https://evil.example/github.com/a/b', 'https://github.com.evil.example/a/b', 'https://github.com/a', 'javascript:alert(1)', 'file:///C:/x', 'https://github.com/a/b c']) {
      assert.equal(issuesUrl(bad), '', bad)
    }
  })
})
