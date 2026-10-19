import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/config.ts'
import { AutoStepCore } from '../src/core.ts'
import { DemoAdapter } from '../src/demo.ts'
import { parseSimbriefOfp } from '../src/plan.ts'
import type { FlightPlan } from '../src/types.ts'
import { STEP_ALONG_NM, makeAircraft, makeEngine, makePlan, run, smallOfp } from './helpers.ts'
import type { Sent } from './helpers.ts'
import type { FakeAircraft } from '../src/fake-sim.ts'

const requestsOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'atc-request')
const notesOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'notify')
/** Everything the engine could send to the aircraft itself: the FCU and the autopilot. */
const simCommandsOf = (sent: Sent[]): Sent[] => sent.filter((s) => s.cmd.type === 'fcu-click' || s.cmd.type === 'set-altitude' || s.cmd.type === 'engage')

/** An aircraft the app does not control, with BeyondATC connected. */
function otherAircraft(reply: 'grant' | 'refuse' | 'silent' | 'unavailable' = 'grant', alt = 34000, along = 500): FakeAircraft {
  const ac = makeAircraft(along, alt)
  ac.control = 'none'
  ac.atc = { connected: true, request: null }
  ac.atcReply = reply
  return ac
}

/** What an aircraft's own automatic step climb does: at the step point it sets the level and climbs. */
function autoStep(ac: FakeAircraft): () => void {
  let started = false
  return () => {
    if (!started && ac.alongNm >= STEP_ALONG_NM) {
      started = true
      ac.fcuSelectedFt = 36000
      ac.execute({ type: 'engage', mode: 'managed' })
    }
  }
}

function downPlan(): FlightPlan {
  const plan = makePlan()
  plan.steps = [{ ...plan.steps[0]!, label: 'FIX2 FL340', fromAltFt: 36000, toAltFt: 34000 }]
  return plan
}

describe('asking BeyondATC for an aircraft the app does not control', () => {
  it('asks about 10 NM before the step point, tells you the answer, and sends nothing to the aircraft', () => {
    const ac = otherAircraft()
    const engine = makeEngine({ atcOtherAircraft: true })
    const climbs = autoStep(ac)
    const sent = run(engine, ac, 1200, climbs)

    const ask = requestsOf(sent)[0]!
    assert.deepEqual(ask.cmd, { type: 'atc-request', altFt: 36000 })
    assert.ok(ask.alongNm > STEP_ALONG_NM - 10.5 && ask.alongNm < STEP_ALONG_NM - 9, `asked at ${ask.alongNm} NM, the fix is at ${STEP_ALONG_NM}`)
    assert.equal(simCommandsOf(sent).length, 0, 'nothing is built for the aircraft: it climbed by itself')
    const cleared = notesOf(sent).map((s) => (s.cmd.type === 'notify' ? s.cmd.title : ''))
    assert.deepEqual(cleared, ['BeyondATC cleared FL360'])
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'done')
    assert.equal(st.note, 'reached FL360')
    assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360')))
    assert.ok(engine.logs.some((l) => l.text.includes('the aircraft reached FL360')))
    assert.equal(engine.status.askOnly, true)
  })

  it('needs neither Live control nor "Ask BeyondATC first"', () => {
    const ac = otherAircraft()
    const engine = makeEngine({ atcOtherAircraft: true, live: false, atcFirst: false })
    const sent = run(engine, ac, 1200, autoStep(ac))
    assert.equal(requestsOf(sent).length, 1)
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(simCommandsOf(sent).length, 0)
  })

  it('never climbs the aircraft itself, whatever else is switched on', () => {
    const ac = otherAircraft('refuse')
    const engine = makeEngine({ atcOtherAircraft: true, live: true, atcFirst: true, atcClimbAnyway: true, stepDowns: true, atcRetryMs: 30_000 })
    const sent = run(engine, ac, 1500)
    assert.equal(simCommandsOf(sent).length, 0)
    assert.equal(ac.altFt, 34000, 'the aircraft is where it was')
  })

  it('says so when BeyondATC does not clear it, asks once more, and does not touch the aircraft', () => {
    const ac = otherAircraft('refuse')
    const engine = makeEngine({ atcOtherAircraft: true, atcRetryMs: 30_000 })
    const sent = run(engine, ac, 1500)

    assert.equal(requestsOf(sent).length, 2)
    const notes = notesOf(sent).map((s) => (s.cmd.type === 'notify' ? s.cmd.title : ''))
    assert.deepEqual(notes, ['BeyondATC did not clear FL360'])
    assert.equal(simCommandsOf(sent).length, 0)
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'skipped', 'the aircraft never climbed, and the step point has gone by')
    assert.match(st.note, /passed/)
  })

  it('marks the step done when the aircraft climbs by itself even though BeyondATC said no', () => {
    const ac = otherAircraft('refuse')
    const engine = makeEngine({ atcOtherAircraft: true, atcRetryMs: 30_000 })
    run(engine, ac, 1500, autoStep(ac))
    const st = engine.status.steps[0]!
    assert.equal(st.status, 'done')
    assert.equal(st.note, 'reached FL360')
  })

  it('does not call a step stale while the aircraft is climbing to it, even past the late limit', () => {
    const ac = otherAircraft('silent', 34000, 580)
    ac.atcDelayMs = 900_000 // BeyondATC takes its time
    const engine = makeEngine({ atcOtherAircraft: true, atcTimeoutMs: 900_000 })
    let started = false
    let pastTheLimitClimbing = false
    run(engine, ac, 1100, (a) => {
      if (!started && a.alongNm >= STEP_ALONG_NM + 35) {
        started = true // its own step climb starts 35 NM after the step point and carries on past 40 NM
        a.fcuSelectedFt = 36000
        a.execute({ type: 'engage', mode: 'managed' })
      }
      if (started && a.alongNm > STEP_ALONG_NM + 41 && a.vsFpm > 300) pastTheLimitClimbing = true
    })
    assert.equal(pastTheLimitClimbing, true, 'the test did climb past the late limit')
    const st = engine.status.steps[0]!
    assert.equal(started, true)
    assert.equal(st.status, 'done')
    assert.equal(st.note, 'reached FL360')
  })

  it('waits when BeyondATC is not connected, says so once, and asks as soon as it is', () => {
    const ac = otherAircraft()
    ac.atc = { connected: false, request: null }
    const engine = makeEngine({ atcOtherAircraft: true })
    const messages = new Set<string>()
    const sent = run(engine, ac, 1200, (a) => {
      messages.add(engine.status.message)
      if (a.alongNm > STEP_ALONG_NM - 5) a.atc = { connected: true, request: a.atc?.request ?? null }
    })
    assert.ok([...messages].some((m) => /ATC is not connected/.test(m)))
    assert.equal(notesOf(sent).filter((s) => s.cmd.type === 'notify' && /not connected/.test(s.cmd.title)).length, 1, 'said once')
    assert.equal(requestsOf(sent).length, 1, 'and asked once it was there')
    assert.ok(engine.logs.some((l) => l.text.includes('ATC cleared FL360')))
  })

  it('does not ask while the step point is far off', () => {
    const ac = otherAircraft('grant', 34000, 300)
    const engine = makeEngine({ atcOtherAircraft: true })
    const sent = run(engine, ac, 300)
    assert.equal(requestsOf(sent).length, 0)
    assert.match(engine.status.message, /in \d+ NM/)
  })

  it('waits for the cruise before it asks', () => {
    const ac = otherAircraft('grant', 15_000, 596) // 4 NM before the step point, but nowhere near the cruise
    const engine = makeEngine({ atcOtherAircraft: true })
    const sent = run(engine, ac, 200)
    assert.equal(requestsOf(sent).length, 0)
    assert.match(engine.status.message, /stable cruise/)
  })

  it('skips a step the aircraft is already at or above', () => {
    const ac = otherAircraft('grant', 36000)
    const engine = makeEngine({ atcOtherAircraft: true })
    const sent = run(engine, ac, 800)
    assert.equal(requestsOf(sent).length, 0)
    assert.equal(engine.status.steps[0]!.status, 'skipped')
    assert.match(engine.status.steps[0]!.note, /already at or above/)
  })

  it('does not hold a step for weight: it only asks', () => {
    const ac = otherAircraft()
    ac.weightKg = 250_000
    const engine = makeEngine({ atcOtherAircraft: true })
    const sent = run(engine, ac, 1200, autoStep(ac))
    assert.equal(requestsOf(sent).length, 1)
    assert.equal(engine.status.steps[0]!.status, 'done')
  })

  it('asks for a step down only when step downs are on', () => {
    const off = makeEngine({ atcOtherAircraft: true }, downPlan())
    const sentOff = run(off, otherAircraft('grant', 36000), 1200)
    assert.equal(requestsOf(sentOff).length, 0)
    assert.match(off.status.steps[0]!.note, /step downs are switched off/)

    const on = makeEngine({ atcOtherAircraft: true, stepDowns: true }, downPlan())
    const sentOn = run(on, otherAircraft('grant', 36000), 1200)
    assert.deepEqual(requestsOf(sentOn)[0]!.cmd, { type: 'atc-request', altFt: 34000 })
    assert.equal(simCommandsOf(sentOn).length, 0)
  })

  it('Step now does nothing for such an aircraft', () => {
    const ac = otherAircraft()
    const engine = makeEngine({ atcOtherAircraft: true })
    run(engine, ac, 60)
    assert.equal(engine.stepNow(), false)
    const sent = run(engine, ac, 60)
    assert.equal(simCommandsOf(sent).length, 0)
  })

  it('stays out of the way when asking in other aircraft is switched off', () => {
    const ac = otherAircraft()
    const engine = makeEngine({ atcOtherAircraft: false })
    const sent = run(engine, ac, 1200)
    assert.equal(sent.length, 0)
    assert.match(engine.status.message, /Unsupported aircraft/)
    assert.equal(engine.status.askOnly, false)
  })

  it('flies an aircraft that has controls exactly as before, with the switch on', () => {
    const ac = makeAircraft()
    const engine = makeEngine({ atcOtherAircraft: true })
    const sent = run(engine, ac, 1200)
    assert.ok(sent.some((s) => s.cmd.type === 'fcu-click'))
    assert.equal(engine.status.steps[0]!.status, 'done')
    assert.equal(ac.altFt, 36000)
    assert.equal(engine.status.askOnly, false)
  })

  it('goes back to "controlled" when the aircraft changes', () => {
    const other = otherAircraft()
    const engine = makeEngine({ atcOtherAircraft: true })
    run(engine, other, 5)
    assert.equal(engine.status.askOnly, true)
    run(engine, makeAircraft(), 5)
    assert.equal(engine.status.askOnly, false)
  })
})

describe('the preview of an aircraft the app does not control', () => {
  it('has no profile, is not an A330, and climbs by itself at each step point', () => {
    const plan = parseSimbriefOfp(smallOfp())
    const adapter = new DemoAdapter(plan, { preview: true, otherAircraft: true })
    assert.equal(adapter.profile, null)
    assert.equal(adapter.aircraft.title, 'Other aircraft (PREVIEW)')
    assert.equal(adapter.aircraft.aircraftOk, false)
  })
})

describe('asking BeyondATC in other aircraft: the core', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const root = path.resolve(import.meta.dirname, '..')

  async function made(over: Record<string, unknown>): Promise<{ core: AutoStepCore; dir: string; settings: () => Record<string, unknown> }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-other-'))
    const configFile = path.join(dir, 'config.json')
    fs.writeFileSync(path.join(dir, 'ofp.json'), JSON.stringify(smallOfp()))
    fs.writeFileSync(configFile, JSON.stringify({ planFile: 'ofp.json' }))
    const core = await AutoStepCore.create({
      host: 'app',
      version: 'test',
      simulated: null,
      live: 'config',
      configFile,
      profileDirs: [path.join(root, 'profiles')],
      logDir: path.join(dir, 'logs'),
      stateFile: path.join(dir, 'state.json'),
      persistSettings: true,
      echo: false,
      ...over
    })
    return { core, dir, settings: () => JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown> }
  }

  type State = { engine: { atcOtherAircraft: boolean; askOnly: boolean; message: string }; atc: { enabled: boolean }; sim: { aircraftOk: boolean; profile: unknown } }

  it('is off until it is switched on, is saved, and turns the BeyondATC link on and off', async () => {
    const m = await made({})
    try {
      const state = (): State => m.core.getState() as unknown as State
      assert.equal(state().engine.atcOtherAircraft, false)
      assert.equal(state().atc.enabled, false)
      await m.core.actions['atc-other-aircraft']!({ enabled: true })
      assert.equal(state().engine.atcOtherAircraft, true)
      assert.equal(state().atc.enabled, true)
      assert.equal((m.settings().engine as Record<string, unknown>).atcOtherAircraft, true)
      await m.core.actions['atc-other-aircraft']!({ enabled: false })
      assert.equal(state().engine.atcOtherAircraft, false)
      assert.equal(state().atc.enabled, false)
      assert.equal((m.settings().engine as Record<string, unknown>).atcOtherAircraft, false)
    } finally {
      m.core.stop()
      fs.rmSync(m.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  it('keeps the BeyondATC link on while either mode needs it', async () => {
    const m = await made({})
    try {
      const enabled = (): boolean => (m.core.getState() as unknown as State).atc.enabled
      await m.core.actions['atc-first']!({ enabled: true })
      await m.core.actions['atc-other-aircraft']!({ enabled: true })
      await m.core.actions['atc-first']!({ enabled: false })
      assert.equal(enabled(), true, 'still wanted by the other-aircraft mode')
      await m.core.actions['atc-other-aircraft']!({ enabled: false })
      assert.equal(enabled(), false)
    } finally {
      m.core.stop()
      fs.rmSync(m.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  it('follows an aircraft with no profile only while the switch is on, and then only asks', async () => {
    const m = await made({ simulated: 'preview', demoUnsupported: true })
    try {
      const state = (): State => m.core.getState() as unknown as State
      m.core.start()
      await sleep(1000)
      assert.equal(state().sim.aircraftOk, false)
      assert.equal(state().engine.askOnly, false)
      assert.match(state().engine.message, /Unsupported aircraft/)

      await m.core.actions['atc-other-aircraft']!({ enabled: true })
      await sleep(1000)
      assert.equal(state().sim.aircraftOk, true)
      assert.equal(state().engine.askOnly, true)
      assert.equal(state().sim.profile, null)
      assert.doesNotMatch(state().engine.message, /Unsupported aircraft/)
    } finally {
      m.core.stop()
      fs.rmSync(m.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  it('leaves an aircraft that has a profile alone, with the switch on', async () => {
    const m = await made({ simulated: 'preview' })
    try {
      const state = (): State => m.core.getState() as unknown as State
      await m.core.actions['atc-other-aircraft']!({ enabled: true })
      m.core.start()
      await sleep(1000)
      assert.equal(state().sim.aircraftOk, true)
      assert.equal(state().engine.askOnly, false)
    } finally {
      m.core.stop()
      fs.rmSync(m.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  it('reads its two settings from config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-config-'))
    try {
      const file = path.join(dir, 'config.json')
      assert.equal(loadConfig(file).config.engine.atcOtherAircraft, false)
      assert.equal(loadConfig(file).config.engine.atcOtherLeadNm, 10)
      fs.writeFileSync(file, JSON.stringify({ engine: { atcOtherAircraft: true, atcOtherLeadNm: 80 } }))
      const loaded = loadConfig(file)
      assert.equal(loaded.config.engine.atcOtherAircraft, true)
      assert.equal(loaded.config.engine.atcOtherLeadNm, 80)
      assert.deepEqual(loaded.warnings, [])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
