import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { AutoStepCore } from '../src/core.ts'
import { FakeAircraft } from '../src/fake-sim.ts'
import { parseSimbriefOfp } from '../src/plan.ts'
import type { SimAdapter } from '../src/sim.ts'
import type { SimCommand, Snapshot } from '../src/types.ts'
import { smallOfp } from './helpers.ts'

const root = path.resolve(import.meta.dirname, '..')

/** Stands in for the sim: the test pushes readings in, and what the engine sends goes to a simulated aircraft. */
class Wire implements SimAdapter {
  readonly kind = 'demo' as const
  readonly connected = true
  readonly profile = null
  readonly ac: FakeAircraft
  private onSnapshot: ((s: Snapshot | null) => void) | null = null
  constructor(ac: FakeAircraft) {
    this.ac = ac
  }
  get lastDataAt(): number {
    return Date.now()
  }
  start(cb: (s: Snapshot | null) => void): void {
    this.onSnapshot = cb
  }
  execute(cmd: SimCommand): void {
    this.ac.execute(cmd)
  }
  stop(): void {}
  /** Fly for this many seconds of the aircraft's own clock, one reading each second. */
  fly(seconds: number): void {
    for (let i = 0; i < seconds; i++) {
      this.onSnapshot!(this.ac.snapshot())
      this.ac.advance(1000)
    }
  }
}

interface Flight {
  core: AutoStepCore
  wire: Wire
  ac: FakeAircraft
  notes: { title: string; text: string }[]
  settings: () => Record<string, unknown>
  state: () => { engine: { phase: string; message: string; weightGuard: boolean; heldForWeight: boolean; steps: { status: string }[] } }
  done: () => void
}

/**
 * The real core, started, with the readings and the commands going to a simulated aircraft that flies the plan's
 * route. The step is at fix A, 90 NM along; the plan's weight there is 200 t.
 */
async function startFlight(config: Record<string, unknown>, aircraft: { startAlongNm?: number; weightKg?: number } = {}): Promise<Flight> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-flight-'))
  const configFile = path.join(dir, 'config.json')
  fs.writeFileSync(path.join(dir, 'ofp.json'), JSON.stringify(smallOfp()))
  fs.writeFileSync(configFile, JSON.stringify({ planFile: 'ofp.json', ...config }))
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
    echo: false
  })
  await core.loadInitialPlan()
  const plan = parseSimbriefOfp(smallOfp())
  const ac = new FakeAircraft({ route: plan.route, startAlongNm: aircraft.startAlongNm ?? 40, altFt: 34_000, weightKg: aircraft.weightKg ?? 180_000 })
  const wire = new Wire(ac)
  core.adapter = wire
  const notes: { title: string; text: string }[] = []
  core.hooks.onNotify = (n) => notes.push(n)
  core.start()
  return {
    core,
    wire,
    ac,
    notes,
    settings: () => JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>,
    state: () => core.getState() as unknown as ReturnType<Flight['state']>,
    done: () => {
      core.stop()
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
}

const titles = (f: Flight): string[] => f.notes.map((n) => n.title)

describe('the core tells the person what happens to a step', () => {
  it('with live control: the step starts and is complete, each told once', async () => {
    const f = await startFlight({ live: true })
    try {
      f.wire.fly(900)
      assert.equal(f.ac.altFt, 36_000)
      assert.deepEqual(titles(f), ['Step climb started', 'Step climb complete'])
      assert.match(f.notes[0]!.text, /A FL360/)
      assert.match(f.notes[1]!.text, /FL360/)
    } finally {
      f.done()
    }
  })

  it('while only watching: says the step was not flown, and the aircraft is sent nothing', async () => {
    const f = await startFlight({})
    try {
      f.wire.fly(600)
      assert.deepEqual(titles(f), ['Watching only: the step was not flown'])
      assert.match(f.notes[0]!.text, /Turn it on in Settings/)
      assert.equal(f.ac.commands.length, 0)
    } finally {
      f.done()
    }
  })

  it('says once that a step is held for weight, then flies it when the aircraft is light enough', async () => {
    const f = await startFlight({ live: true }, { weightKg: 215_000 })
    try {
      f.wire.fly(500)
      assert.deepEqual(titles(f), ['Step held: the aircraft is too heavy'])
      assert.match(f.notes[0]!.text, /heavier than the OFP planned/)
      assert.equal(f.state().engine.heldForWeight, true)

      f.ac.weightKg = 180_000
      f.wire.fly(400)
      assert.deepEqual(titles(f), ['Step held: the aircraft is too heavy', 'Step climb started', 'Step climb complete'])
      assert.equal(f.ac.altFt, 36_000)
    } finally {
      f.done()
    }
  })
})

describe('the weight check switch', () => {
  it('is on by default, is saved when it is switched, and a heavy aircraft is then not held', async () => {
    const f = await startFlight({ live: true }, { weightKg: 215_000 })
    try {
      assert.equal(f.state().engine.weightGuard, true)
      await f.core.actions['weight-guard']!({ enabled: false })
      assert.equal(f.state().engine.weightGuard, false)
      assert.equal((f.settings().engine as Record<string, unknown>).weightGuard, false)

      f.wire.fly(900)
      assert.deepEqual(titles(f), ['Step climb started', 'Step climb complete'], 'flown although 7.5% over the plan')
      assert.equal(f.ac.altFt, 36_000)

      await f.core.actions['weight-guard']!({ enabled: true })
      assert.equal(f.state().engine.weightGuard, true)
      assert.equal((f.settings().engine as Record<string, unknown>).weightGuard, true)
    } finally {
      f.done()
    }
  })
})

describe('the core and a paused sim', () => {
  it('marks the readings, holds the step through the pause and flies it afterwards', async () => {
    const f = await startFlight({ live: true })
    try {
      for (let i = 0; i < 2000 && f.state().engine.phase !== 'engaging'; i++) f.wire.fly(1)
      assert.equal(f.state().engine.phase, 'engaging')
      const engages = (): number => f.ac.commands.filter((c) => c.type === 'engage').length
      assert.equal(engages(), 1)

      f.ac.rate = 0
      f.wire.fly(180)
      assert.equal(f.core.latest?.simPaused, true, 'the core marks the reading')
      assert.match(f.state().engine.message, /paused/)
      assert.equal(f.state().engine.phase, 'engaging')
      assert.equal(engages(), 1, 'no second try while paused')

      f.ac.rate = 1
      f.wire.fly(400)
      assert.equal(f.state().engine.steps[0]!.status, 'done')
      assert.equal(f.ac.altFt, 36_000)
      assert.equal(engages(), 1)
      assert.deepEqual(titles(f), ['Step climb started', 'Step climb complete'])
    } finally {
      f.done()
    }
  })
})
