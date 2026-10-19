import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { DemoAdapter, makeDemoPlan, planLevelLabels } from '../src/demo.ts'
import { parseSimbriefOfp } from '../src/plan.ts'
import { isAlive, pidFilePath, probe, readPidFile, removePidFile, requestQuit } from '../src/background.ts'
import { smallOfp } from './helpers.ts'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const randomPort = (): number => 20_000 + Math.floor(Math.random() * 20_000)

describe('preview adapter', () => {
  it('starts a real plan at its first cruise fix, at its level and weight', () => {
    const plan = parseSimbriefOfp(smallOfp())
    const adapter = new DemoAdapter(plan, { preview: true })
    const a = adapter.aircraft
    assert.equal(a.altFt, 34000)
    assert.equal(a.weightKg, 200_000) // 100,000 ZFW + 100,000 planned fuel at the first cruise fix
    assert.equal(a.title, 'A330 (PREVIEW)')
    assert.equal(adapter.profile?.name, 'Preview aircraft')
    assert.ok(a.alongNm > 60 && a.alongNm < 100, `starts ${a.alongNm} NM along, just past the first cruise fix`)
  })

  it('falls back to the made-up route when the plan has none', () => {
    const adapter = new DemoAdapter({ ...makeDemoPlan(), route: [] }, { preview: true })
    assert.equal(adapter.aircraft.title, 'A330-300 (DEMO)')
    assert.ok(adapter.aircraft.totalNm > 100)
  })

  it('writes the levels of a plan the way BeyondATC does', () => {
    assert.deepEqual(planLevelLabels(parseSimbriefOfp(smallOfp())), ['FL340', 'FL360'])
  })
})

describe('preview in the background', () => {
  it('flies the real plan with a simulated aircraft, on its own port', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-preview-'))
    const planFile = path.join(dir, 'ofp.json')
    const configFile = path.join(dir, 'config.json')
    fs.writeFileSync(planFile, JSON.stringify(smallOfp()))
    fs.writeFileSync(configFile, JSON.stringify({ planFile, port: randomPort() }))
    const port = JSON.parse(fs.readFileSync(configFile, 'utf8')).port + 1 // a preview uses the next port up
    const pidFile = pidFilePath(dir, port)
    try {
      const started = await run(process.execPath, ['src/main.ts', '--preview', '--background', '--config', configFile], {
        cwd: root,
        timeout: 25_000,
        env: { ...process.env, AUTOSTEP_LOG_DIR: dir, AUTOSTEP_NO_TRAY: '1' }
      })
      assert.match(started.stdout, /Running in the background \(preview\)/)

      const state = await probe(port)
      assert.ok(state, 'the dashboard answers on the next port up')
      assert.equal(state.app.mode, 'preview')
      assert.deepEqual(
        state.engine.steps.map((s) => s.step.label),
        ['A FL360']
      )

      // The aircraft flies to the step and the engine does it, all against the simulated aircraft.
      const t0 = Date.now()
      let done = false
      while (!done && Date.now() - t0 < 40_000) {
        await new Promise((r) => setTimeout(r, 500))
        done = (await probe(port, 500))?.engine.steps[0]?.status === 'done'
      }
      assert.ok(done, 'the step was flown')
    } finally {
      await requestQuit(port)
      const pid = readPidFile(pidFile)
      if (pid !== null && isAlive(pid)) process.kill(pid)
      removePidFile(pidFile)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
