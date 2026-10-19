import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { airportFileText } from '../src/airports-build.ts'
import { AutoStepCore, cleanSimbriefName } from '../src/core.ts'
import type { CoreOptions } from '../src/core.ts'
import type { Snapshot } from '../src/types.ts'
import { smallOfp } from './helpers.ts'

const root = path.resolve(import.meta.dirname, '..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Made {
  core: AutoStepCore
  dir: string
  configFile: string
  stateFile: string
  settings: () => Record<string, unknown>
}

/**
 * A core in a temp folder. It is never started, so it never reaches for the sim, the ATC program or the network:
 * the flight plan comes from a file in the folder.
 */
async function make(over: Partial<CoreOptions> = {}, config: Record<string, unknown> = {}, ofp: Record<string, unknown> | null = smallOfp()): Promise<Made> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-core-'))
  const configFile = path.join(dir, 'config.json')
  const stateFile = path.join(dir, 'state.json')
  const planFile = path.join(dir, 'ofp.json')
  if (ofp) fs.writeFileSync(planFile, JSON.stringify(ofp))
  fs.writeFileSync(configFile, JSON.stringify({ ...(ofp ? { planFile: 'ofp.json' } : {}), ...config }))
  const core = await AutoStepCore.create({
    host: 'app',
    version: 'test',
    simulated: null,
    live: 'config',
    configFile,
    profileDirs: [path.join(root, 'profiles')],
    logDir: path.join(dir, 'logs'),
    stateFile,
    persistSettings: true,
    echo: false,
    ...over
  })
  return { core, dir, configFile, stateFile, settings: () => JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown> }
}

async function using<T>(made: Made, fn: (m: Made) => Promise<T> | T): Promise<T> {
  try {
    return await fn(made)
  } finally {
    made.core.stop()
    fs.rmSync(made.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

/** A reading of an A330 parked at the given place. */
function parked(lat: number, lon: number): Snapshot {
  return { t: Date.now(), title: 'A330-300 iniBuilds', aircraftOk: true, onGround: true, lat, lon, altFt: 83, vsFpm: 0, mach: 0, gsKt: 0, weightKg: 200_000, fcuSelectedFt: 0, apTargetFt: 0, control: 'knob' }
}

describe('cleanSimbriefName', () => {
  it('keeps a normal name and clears an empty one', () => {
    assert.equal(cleanSimbriefName('  examplepilot '), 'examplepilot')
    assert.equal(cleanSimbriefName('Pilot_One-2.0'), 'Pilot_One-2.0')
    assert.equal(cleanSimbriefName('   '), '')
  })
  it('refuses anything that is not part of a name', () => {
    for (const bad of ['a/b', 'a&b=c', 'a?b', 'a#b', '<script>', 'x'.repeat(65)]) assert.throws(() => cleanSimbriefName(bad), /letters, digits/, bad)
  })
})

describe('the core, as the Windows app uses it', () => {
  it('starts as a dry run and reads its settings from config.json', async () => {
    await using(await make({}, { simbrief: { username: 'examplepilot' }, openWindowAtAirport: false, engine: { confirmEachStep: true } }), async ({ core }) => {
      const state = core.getState() as { app: Record<string, unknown>; settings: Record<string, unknown> }
      assert.equal(state.app.host, 'app')
      assert.equal(state.app.mode, 'dry-run')
      assert.equal(state.app.port, null)
      assert.equal(state.settings.simbriefUsername, 'examplepilot')
      assert.equal(state.settings.live, false)
      assert.equal(state.settings.confirmEachStep, true)
      assert.equal(state.settings.openWindowAtAirport, false)
    })
  })

  it('starts live only when config.json says live, and the command line version never does from config.json', async () => {
    await using(await make({}, { live: true }), async ({ core }) => assert.equal(core.mode, 'live'))
    await using(await make({ host: 'cli', live: false, persistSettings: false, echo: false }, { live: true, engine: { live: true } }), async ({ core }) => {
      assert.equal(core.mode, 'dry-run')
      assert.equal((core.getState() as { settings: unknown }).settings, null)
    })
  })

  it('switches live control on and off, saves it, and tells the engine and the sim adapter', async () => {
    await using(await make(), async ({ core, settings }) => {
      assert.equal(core.mode, 'dry-run')
      await core.actions['set-live']!({ enabled: true })
      assert.equal(core.mode, 'live')
      assert.equal(core.engine.options.live, true)
      assert.equal(settings().live, true)
      await core.actions['set-live']!({ enabled: false })
      assert.equal(core.mode, 'dry-run')
      assert.equal(settings().live, false)
    })
  })

  it('will not change live control while a step is being flown', async () => {
    await using(await make(), async ({ core }) => {
      ;(core.engine as unknown as { actuating: () => boolean }).actuating = () => true
      assert.throws(() => core.setLive(true), /press Stop first/)
      assert.equal(core.mode, 'dry-run')
    })
  })

  it('saves the other switches, and leaves what the user wrote in config.json alone', async () => {
    await using(await make({}, { stepAt: 'fix', engine: { leadNm: 4 } }), async ({ core, settings }) => {
      await core.actions['set-confirm-each']!({ enabled: true })
      await core.actions['step-downs']!({ enabled: true })
      await core.actions['atc-first']!({ enabled: false })
      await core.actions['atc-climb-anyway']!({ enabled: true })
      await core.actions['set-window-at-airport']!({ enabled: false })
      const saved = settings()
      assert.equal(saved.stepAt, 'fix')
      assert.deepEqual(saved.engine, { leadNm: 4, confirmEachStep: true, stepDowns: true, atcFirst: false, atcClimbAnyway: true })
      assert.equal(core.engine.options.atcClimbAnyway, true)
      assert.equal(saved.openWindowAtAirport, false)
      assert.equal(core.engine.options.confirmEachStep, true)
      assert.equal(core.config.openWindowAtAirport, false)
    })
  })

  it('keeps "climb anyway" off until it is switched on, saves it, and shows it in the status', async () => {
    const shown = (core: AutoStepCore): boolean => (core.getState() as { engine: { atcClimbAnyway: boolean } }).engine.atcClimbAnyway
    await using(await make(), async ({ core, settings }) => {
      assert.equal(core.engine.options.atcClimbAnyway, false)
      assert.equal(shown(core), false)
      await core.actions['atc-climb-anyway']!({ enabled: true })
      assert.equal(core.engine.options.atcClimbAnyway, true)
      assert.equal(shown(core), true)
      assert.equal((settings().engine as Record<string, unknown>).atcClimbAnyway, true)
      assert.ok(core.getState().logs && (core.getState().logs as { text: string }[]).some((l) => /Climb anyway: on/.test(l.text)))
      await core.actions['atc-climb-anyway']!({ enabled: false })
      assert.equal(core.engine.options.atcClimbAnyway, false)
      assert.equal((settings().engine as Record<string, unknown>).atcClimbAnyway, false)
    })
    // a later start reads it from config.json
    await using(await make({}, { engine: { atcClimbAnyway: true } }), async ({ core }) => {
      assert.equal(core.engine.options.atcClimbAnyway, true)
    })
  })

  it('says "watching only", not "dry run", when live control is off', async () => {
    await using(await make(), async ({ core }) => {
      const result = (await core.actions['set-live']!({ enabled: false })) as unknown
      assert.match(String(result), /watching only/)
      assert.ok((core.getState().logs as { text: string }[]).some((l) => /watching only/.test(l.text)))
    })
  })

  it('does not save anything for the command line version', async () => {
    await using(await make({ host: 'cli', persistSettings: false }), async ({ core, configFile }) => {
      const before = fs.readFileSync(configFile, 'utf8')
      await core.actions['step-downs']!({ enabled: true })
      assert.equal(fs.readFileSync(configFile, 'utf8'), before)
      assert.equal(core.actions['set-live'], undefined, 'live control comes from --live there')
    })
  })

  it('cannot switch a simulated run to live', async () => {
    await using(await make({ simulated: 'demo' }, {}, null), async ({ core }) => {
      assert.equal(core.mode, 'demo')
      assert.equal(core.adapter.kind, 'demo', 'a simulated aircraft, never the sim')
      assert.throws(() => core.setLive(true), /simulated/)
    })
  })

  it('saves a SimBrief username, drops a user id that would override it, and loads the plan', async () => {
    await using(await make({}, { simbrief: { username: '', userId: '12345' } }), async ({ core, settings }) => {
      assert.match(String(await core.actions['set-simbrief']!({ username: ' examplepilot ' })), /Saved/)
      assert.deepEqual(settings().simbrief, { username: 'examplepilot', userId: '' })
      await sleep(50)
      assert.equal((core.getState() as { plan: { origin: string } }).plan.origin, 'AAAA')
      await assert.rejects(Promise.resolve().then(() => core.actions['set-simbrief']!({ username: 'a/b' })), /letters, digits/)
      assert.equal((settings().simbrief as { username: string }).username, 'examplepilot', 'a refused name changes nothing')
    })
  })

  it('points at Settings while there is no way to get a flight plan', async () => {
    await using(await make({}, {}, null), async ({ core }) => {
      assert.match(String((core.getState() as { planError: string }).planError), /SimBrief username in Settings/)
      await core.loadPlan()
      assert.match(String((core.getState() as { planError: string }).planError), /SimBrief username in Settings/)
    })
    await using(await make({ host: 'cli', persistSettings: false }, {}, null), async ({ core }) => {
      assert.equal((core.getState() as { planError: unknown }).planError, null, 'the command line version says it only after it tried')
    })
  })

  it('keeps the loaded flight plan when refreshing it fails, and says so', async () => {
    await using(await make(), async ({ core, dir }) => {
      await core.loadPlan()
      assert.equal((core.getState() as { plan: { origin: string } }).plan.origin, 'AAAA')
      fs.writeFileSync(path.join(dir, 'ofp.json'), '{ broken')
      await core.loadPlan({ keepOnError: true })
      const state = core.getState() as { plan: { origin: string }; planError: string }
      assert.equal(state.plan.origin, 'AAAA', 'the good plan is still there')
      assert.match(state.planError, /Keeping the one already loaded/)
      // while a plain reload with nothing to keep still says what is wrong
      await core.loadPlan()
      assert.equal((core.getState() as { plan: unknown }).plan, null)
    })
  })

  it('does not touch the flight plan while a step is being flown', async () => {
    await using(await make(), async ({ core, dir }) => {
      await core.loadPlan()
      ;(core.engine as unknown as { actuating: () => boolean }).actuating = () => true
      fs.writeFileSync(path.join(dir, 'ofp.json'), JSON.stringify(smallOfp('CCCC', 'DDDD')))
      await core.syncPlan(true)
      assert.equal((core.getState() as { plan: { origin: string } }).plan.origin, 'AAAA')
    })
  })

  it("tells the window the flight's name, and an empty one when the plan has none", async () => {
    await using(await make({}, {}, { ...smallOfp(), atc: { callsign: 'TST123' } }), async ({ core }) => {
      await core.loadPlan()
      assert.equal((core.getState() as { plan: { flight: string } }).plan.flight, 'TST123')
    })
    await using(await make(), async ({ core }) => {
      await core.loadPlan()
      assert.equal((core.getState() as { plan: { flight: string } }).plan.flight, '')
    })
  })
})

/** Makes SimBrief answer with whatever `current.ofp` is. Nothing here reaches the network. */
function stubSimbrief(current: { ofp: Record<string, unknown> }): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(current.ofp), { status: 200 })) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

describe('keeping the flight plan up to date', () => {
  const origin = (core: AutoStepCore): string | undefined => (core.getState() as { plan: { origin: string } | null }).plan?.origin

  it('loads the plan when there is none, in the air or on the ground', async () => {
    const current = { ofp: smallOfp('AAAA', 'BBBB', '1760000000') }
    const restore = stubSimbrief(current)
    try {
      await using(await make({}, { simbrief: { username: 'examplepilot' } }, null), async ({ core }) => {
        assert.equal(core.planAttempted, false)
        await core.syncPlan(false)
        assert.equal(origin(core), 'AAAA')
        assert.equal(core.planAttempted, true)
      })
    } finally {
      restore()
    }
  })

  it('switches to an OFP generated after the one in use, but only while parked', async () => {
    const current = { ofp: smallOfp('AAAA', 'BBBB', '1760000000') }
    const restore = stubSimbrief(current)
    try {
      await using(await make({}, { simbrief: { username: 'examplepilot' } }, null), async ({ core }) => {
        await core.syncPlan(true)
        assert.equal(origin(core), 'AAAA')

        current.ofp = smallOfp('AAAA', 'BBBB', '1760000000') // the very same OFP again: nothing changes
        assert.equal(await core.refreshPlanIfNewer(), false)

        current.ofp = smallOfp('BBBB', 'CCCC', '1760003600') // the next flight's OFP, generated an hour later
        await core.syncPlan(false) // flying: the plan in use is never swapped
        assert.equal(origin(core), 'AAAA')
        await core.syncPlan(true) // parked: picked up
        assert.equal(origin(core), 'BBBB')

        current.ofp = smallOfp('CCCC', 'DDDD', '1760007200')
        await core.actions['set-steps']!({ text: '' }) // steps typed by hand are never replaced
        await core.syncPlan(true)
        assert.equal(origin(core), 'BBBB')
      })
    } finally {
      restore()
    }
  })

  it('tries again when the first attempt failed, and then keeps what it got', async () => {
    const current = { ofp: { fetch: { status: 'Error: no OFP' } } as Record<string, unknown> }
    const restore = stubSimbrief(current)
    try {
      await using(await make({}, { simbrief: { username: 'examplepilot' } }, null), async ({ core }) => {
        await core.syncPlan(true)
        assert.equal(origin(core), undefined)
        assert.equal(core.planMissing, true)
        current.ofp = smallOfp('AAAA', 'BBBB')
        await core.syncPlan(false)
        assert.equal(origin(core), 'AAAA')
        assert.equal(core.planMissing, false)
      })
    } finally {
      restore()
    }
  })

  it('never swaps a plan that came from a file, and says nothing when a check fails', async () => {
    await using(await make(), async ({ core, dir }) => {
      await core.loadPlan()
      fs.writeFileSync(path.join(dir, 'ofp.json'), JSON.stringify(smallOfp('CCCC', 'DDDD', '1760009999')))
      assert.equal(await core.refreshPlanIfNewer(), false)
      assert.equal(origin(core), 'AAAA')
    })
  })
})

describe('the core, as the Windows app uses it (continued)', () => {

  it('warns when the aircraft is parked at an airport the flight plan neither starts nor ends at', async () => {
    const airports = (dir: string): string => {
      const file = path.join(dir, 'airports.json')
      fs.writeFileSync(file, airportFileText([['EGLL', 'London Heathrow Airport', 51.4706, -0.4619, 83], ['EGKK', 'London Gatwick Airport', 51.1481, -0.1903, 202]], '2026-10-17'))
      return file
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-core-airports-'))
    try {
      await using(await make({ airportsFile: airports(dir) }, {}, smallOfp('EGLL', 'KJFK')), async ({ core }) => {
        await core.loadPlan()
        core.latest = parked(51.4706, -0.4619) // at Heathrow, where the plan starts
        assert.equal((core.getState() as { planWarning: unknown }).planWarning, null)
        core.latest = parked(51.1481, -0.1903) // at Gatwick
        assert.match(String((core.getState() as { planWarning: string }).planWarning), /at EGKK, but the flight plan is EGLL to KJFK/)
        core.latest = { ...parked(51.1481, -0.1903), onGround: false } // flying: no warning
        assert.equal((core.getState() as { planWarning: unknown }).planWarning, null)
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('remembers a passed control test, but only for the same profile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-core-profiles-'))
    const name = 'iniBuilds A330 (MSFS 2024)'
    try {
      const a = await make({ stateFile: path.join(dir, 'state.json') })
      await using(a, async ({ core }) => {
        assert.equal(core.isControlTested(name), false)
        core.markControlTested(name)
        assert.equal(core.isControlTested(name), true)
      })
      // a later run, the same profile
      await using(await make({ stateFile: path.join(dir, 'state.json') }), async ({ core }) => assert.equal(core.isControlTested(name), true))
      // the profile has changed since
      const edited = path.join(dir, 'profiles')
      fs.mkdirSync(edited)
      const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'a330.json'), 'utf8')) as Record<string, unknown>
      fs.writeFileSync(path.join(edited, 'a330.json'), JSON.stringify({ ...profile, engage: { managed: [{ inputEvent: 'SOMETHING_ELSE', value: 1 }], open: [] } }))
      await using(await make({ stateFile: path.join(dir, 'state.json'), profileDirs: [edited] }), async ({ core }) => assert.equal(core.isControlTested(name), false))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('remembers that the first-run question was asked', async () => {
    await using(await make(), async ({ core, stateFile }) => {
      assert.equal(core.appStateSnapshot.firstRunDone, false)
      core.markFirstRunDone()
      assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).firstRunDone, true)
    })
  })

  it('lets the host add to the state and ask to be told about a quit', async () => {
    await using(await make(), async ({ core }) => {
      let quits = 0
      core.hooks.hostState = () => ({ app: { startWithWindows: true }, sim: { gate: { verdict: 'ok' } }, launch: { phase: 'no-sim' } })
      core.hooks.onQuit = () => quits++
      const state = core.getState() as { app: Record<string, unknown>; sim: Record<string, unknown>; launch: unknown }
      assert.equal(state.app.startWithWindows, true)
      assert.deepEqual(state.sim.gate, { verdict: 'ok' })
      assert.deepEqual(state.launch, { phase: 'no-sim' })
      assert.match(String(await core.actions.quit!({})), /Closing/)
      await sleep(400)
      assert.equal(quits, 1)
    })
  })
})
