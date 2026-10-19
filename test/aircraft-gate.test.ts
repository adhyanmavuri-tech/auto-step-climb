import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { AircraftGate } from '../src/aircraft-gate.ts'
import type { GateReading } from '../src/aircraft-gate.ts'
import { isAlive, pidFilePath, probe, readPidFile, removePidFile, requestQuit } from '../src/background.ts'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const randomPort = (): number => 20_000 + Math.floor(Math.random() * 20_000)

const A330: GateReading = { title: 'A330-200 (RR)', aircraftOk: true, hasPosition: true, matchedProfile: 'iniBuilds A330 (MSFS 2024)' }
const A320: GateReading = { title: 'FlyByWire A320neo', aircraftOk: false, hasPosition: true, matchedProfile: null }
const gate = (graceMs = 8000) => new AircraftGate({ graceMs, supported: ['iniBuilds A330 (MSFS 2024)'] })

describe('aircraft gate', () => {
  it('waits while the sim has nothing to say or no aircraft is loaded', () => {
    const g = gate()
    assert.equal(g.update(0, null).verdict, 'waiting')
    assert.equal(g.update(1000, { ...A320, title: '' }).verdict, 'waiting')
    assert.equal(g.update(60_000, { ...A320, hasPosition: false }).verdict, 'waiting', 'a menu or a flight still loading never counts, however long')
  })

  it('is ok the moment a supported aircraft shows, and stays ok whatever is loaded later', () => {
    const g = gate()
    assert.equal(g.update(0, A330).verdict, 'ok')
    assert.equal(g.update(1000, A320).verdict, 'ok')
    assert.equal(g.update(600_000, A320).verdict, 'ok')
  })

  it('gives an unsupported aircraft the grace period before it counts', () => {
    const g = gate(8000)
    assert.equal(g.update(0, A320).verdict, 'waiting')
    assert.equal(g.update(7999, A320).verdict, 'waiting')
    const s = g.update(8000, A320)
    assert.equal(s.verdict, 'unsupported')
    assert.equal(s.title, 'FlyByWire A320neo')
    assert.match(s.reason!, /"FlyByWire A320neo"/)
    assert.match(s.reason!, /only works with iniBuilds A330 \(MSFS 2024\)/)
    assert.match(s.reason!, /start the app again/)
    assert.equal(s.short, 'FlyByWire A320neo is not supported')
  })

  it('starts the grace period again when the aircraft changes, or when the sim goes quiet', () => {
    const g = gate(8000)
    g.update(0, A320)
    g.update(6000, { ...A320, title: 'Cessna 172' }) // another title: a flight is still loading
    assert.equal(g.update(9000, { ...A320, title: 'Cessna 172' }).verdict, 'waiting', 'counted from the change')
    g.update(10_000, null) // no data: the count is dropped
    assert.equal(g.update(11_000, { ...A320, title: 'Cessna 172' }).verdict, 'waiting')
    assert.equal(g.update(19_000, { ...A330, aircraftOk: true }).verdict, 'ok', 'the A330 loaded in time')
  })

  it('stays unsupported once decided', () => {
    const g = gate(1000)
    g.update(0, A320)
    assert.equal(g.update(1000, A320).verdict, 'unsupported')
    assert.equal(g.update(2000, A330).verdict, 'unsupported', 'the app is closing: it does not change its mind')
  })

  it('says so when the aircraft matches a profile but its controls are missing', () => {
    const g = gate(1000)
    const missing: GateReading = { ...A330, aircraftOk: false }
    g.update(0, missing)
    const s = g.update(1000, missing)
    assert.equal(s.verdict, 'unsupported')
    assert.match(s.reason!, /matches iniBuilds A330 \(MSFS 2024\), but it doesn't have the controls/)
    assert.equal(s.short, 'A330-200 (RR): its controls are missing')
  })

  it('names the A330 when it has no list of supported aircraft', () => {
    const g = new AircraftGate({ graceMs: 0, supported: [] })
    g.update(0, A320)
    assert.match(g.update(0, A320).reason!, /only works with the iniBuilds A330/)
  })
})

describe('the app and the aircraft gate', () => {
  /** Starts a copy of the demo with no window, in a folder of its own, and always cleans it up. */
  async function withApp<T>(env: Record<string, string>, extraArgs: string[], fn: (app: { port: number; logDir: string; start: () => Promise<{ stdout: string; stderr: string; code: number }> }) => Promise<T>): Promise<T> {
    const port = randomPort()
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-gate-'))
    const pidFile = pidFilePath(logDir, port)
    const start = async (): Promise<{ stdout: string; stderr: string; code: number }> => {
      try {
        const out = await run(process.execPath, ['src/main.ts', '--demo', '--background', '--port', String(port), ...extraArgs], {
          cwd: root,
          timeout: 40_000,
          env: { ...process.env, AUTOSTEP_LOG_DIR: logDir, AUTOSTEP_NO_TRAY: '1', ...env }
        })
        return { ...out, code: 0 }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number }
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? -1 }
      }
    }
    try {
      return await fn({ port, logDir, start })
    } finally {
      await requestQuit(port)
      const pid = readPidFile(pidFile)
      if (pid !== null && isAlive(pid)) {
        try {
          process.kill(pid)
        } catch {
          // already gone
        }
      }
      removePidFile(pidFile)
      fs.rmSync(logDir, { recursive: true, force: true })
    }
  }

  it('does not start with an unsupported aircraft: the launcher says why, and the app closes itself', async () => {
    await withApp({ AUTOSTEP_DEMO_UNSUPPORTED: '1', AUTOSTEP_GATE_GRACE_MS: '800' }, [], async ({ port, logDir, start }) => {
      const r = await start()
      assert.equal(r.code, 1)
      assert.match(r.stderr, /Not started: The loaded aircraft is "A320 \(DEMO\)"\. This app only works with the iniBuilds A330\./)
      assert.doesNotMatch(r.stdout, /Running in the background/)
      for (let i = 0; i < 60 && (await probe(port, 300)); i++) await new Promise((res) => setTimeout(res, 250))
      assert.equal(await probe(port, 300), null, 'the app has closed itself')
      assert.match(fs.readFileSync(path.join(logDir, 'autostep.log'), 'utf8'), /Not starting: The loaded aircraft is "A320 \(DEMO\)"/)
    })
  })

  it('has no gate at all with --any-aircraft, and the dashboard state says so', async () => {
    await withApp({ AUTOSTEP_DEMO_UNSUPPORTED: '1', AUTOSTEP_GATE_GRACE_MS: '800' }, ['--any-aircraft'], async ({ port, start }) => {
      const r = await start()
      assert.equal(r.code, 0)
      assert.equal((await probe(port))?.sim.gate, null)
    })
  })

  it('starts as usual with a supported aircraft, and the dashboard says the check passed', async () => {
    await withApp({}, [], async ({ port, start }) => {
      const r = await start()
      assert.equal(r.code, 0, r.stderr)
      assert.match(r.stdout, /Running in the background \(demo\)/)
      const state = await probe(port)
      assert.deepEqual(state?.sim.gate, { verdict: 'ok', reason: null })
    })
  })

  it('starts with any aircraft when told to', async () => {
    await withApp({ AUTOSTEP_DEMO_UNSUPPORTED: '1', AUTOSTEP_GATE_GRACE_MS: '300' }, ['--any-aircraft'], async ({ port, start }) => {
      const r = await start()
      assert.equal(r.code, 0, r.stderr)
      await new Promise((res) => setTimeout(res, 6_000)) // longer than the grace period and the closing delay
      assert.ok(await probe(port), 'it is still running')
    })
  })
})
