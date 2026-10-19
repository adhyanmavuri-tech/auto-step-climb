import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { isAlive, pidFilePath, probe, readPidFile, removePidFile, requestQuit, writePidFile } from '../src/background.ts'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const randomPort = (): number => 20_000 + Math.floor(Math.random() * 20_000)

async function waitFor(cond: () => Promise<boolean> | boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Starts a copy of the demo with no window, with its log and pid file kept out of the real logs folder. */
async function startDemo(port: number, logDir: string): Promise<{ stdout: string }> {
  return run(process.execPath, ['src/main.ts', '--demo', '--background', '--port', String(port)], {
    cwd: root,
    timeout: 25_000,
    env: { ...process.env, AUTOSTEP_LOG_DIR: logDir, AUTOSTEP_NO_TRAY: '1' } // no tray icon: the tests must not put icons in the tray
  })
}

/** Whatever the test started, make sure it is gone. */
async function cleanUp(port: number, pidFile: string): Promise<void> {
  const pid = readPidFile(pidFile)
  if (pid !== null && isAlive(pid)) {
    try {
      process.kill(pid)
    } catch {
      // already gone
    }
  }
  removePidFile(pidFile)
  await probe(port, 200)
}

describe('pid files', () => {
  it('writes, reads and removes one, and tells a live process from a dead one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-pid-'))
    const file = pidFilePath(dir, 8787)
    assert.equal(readPidFile(file), null)
    writePidFile(file, process.pid)
    assert.equal(readPidFile(file), process.pid)
    assert.equal(isAlive(process.pid), true)
    assert.equal(isAlive(2_147_483_000), false)
    removePidFile(file)
    assert.equal(readPidFile(file), null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('ignores a pid file that is not a number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-pid-'))
    const file = pidFilePath(dir, 1)
    fs.writeFileSync(file, 'not a pid')
    assert.equal(readPidFile(file), null)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('running in the background', () => {
  it('finds nothing on a port nobody is using', async () => {
    assert.equal(await probe(randomPort(), 300), null)
    assert.equal((await requestQuit(randomPort(), 500)).ok, false)
  })

  it('starts with no window, answers, refuses a second copy, and quits on request', async () => {
    const port = randomPort()
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-bg-'))
    const pidFile = pidFilePath(logDir, port)
    try {
      const first = await startDemo(port, logDir)
      assert.match(first.stdout, /Running in the background \(demo\)/)

      const state = await probe(port)
      assert.ok(state, 'the dashboard answers')
      assert.equal(state.app.mode, 'demo')
      assert.equal(state.sim.connected, true)
      const pid = readPidFile(pidFile)
      assert.ok(pid !== null && isAlive(pid), 'the pid file names a live process')
      assert.notEqual(pid, process.pid)

      const second = await startDemo(port, logDir)
      assert.match(second.stdout, /already running/)
      assert.equal(readPidFile(pidFile), pid, 'still the first copy')

      const quit = await requestQuit(port)
      assert.equal(quit.ok, true)
      await waitFor(async () => (await probe(port, 300)) === null)
      await waitFor(() => !isAlive(pid))
      await waitFor(() => readPidFile(pidFile) === null)
      assert.ok(fs.readFileSync(path.join(logDir, 'autostep.log'), 'utf8').includes('Quit requested'), 'the log says why it closed')
    } finally {
      await cleanUp(port, pidFile)
      fs.rmSync(logDir, { recursive: true, force: true })
    }
  })

  it('stop.ts closes it, and says so when nothing is running', async () => {
    const port = randomPort()
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-bg-'))
    const pidFile = pidFilePath(logDir, port)
    const env = { ...process.env, AUTOSTEP_LOG_DIR: logDir }
    try {
      await startDemo(port, logDir)
      assert.ok(await probe(port))

      const stopped = await run(process.execPath, ['scripts/stop.ts', `--port=${port}`], { cwd: root, timeout: 20_000, env })
      assert.match(stopped.stdout, /Stopped/)
      assert.equal(await probe(port, 300), null)

      const again = await run(process.execPath, ['scripts/stop.ts', `--port=${port}`], { cwd: root, timeout: 20_000, env })
      assert.match(again.stdout, /not running/)
    } finally {
      await cleanUp(port, pidFile)
      fs.rmSync(logDir, { recursive: true, force: true })
    }
  })

  it('status.ts reads what it is doing', async () => {
    const port = randomPort()
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-bg-'))
    const pidFile = pidFilePath(logDir, port)
    try {
      await startDemo(port, logDir)
      const status = await run(process.execPath, ['scripts/status.ts', `--port=${port}`], { cwd: root, timeout: 20_000 })
      assert.match(status.stdout, /Running \(demo\)/)
      assert.match(status.stdout, /Sim: connected/)
      assert.match(status.stdout, /BRAVO/)
    } finally {
      await requestQuit(port)
      await cleanUp(port, pidFile)
      fs.rmSync(logDir, { recursive: true, force: true })
    }
  })
})
