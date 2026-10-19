import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { isAlive, pidFilePath, probe, readPidFile, removePidFile, requestQuit } from '../src/background.ts'
import { buildTray, findCompiler, TRAY_EXE } from '../src/tray.ts'
import { decodePng, pixel } from './png.ts'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'tray', 'AutoStepClimbTray.cs')
const randomPort = (): number => 20_000 + Math.floor(Math.random() * 20_000)

interface SelfTest {
  ok: boolean
  error?: string
  level?: string
  tip?: string
  title?: string
  line?: string
  menu?: string[]
  icon?: string
}

type TrayJson = { level: string; tip: string; title: string; line: string }

async function getTray(port: number): Promise<TrayJson> {
  const res = await fetch(`http://127.0.0.1:${port}/api/tray`)
  return (await res.json()) as TrayJson
}

/** Runs the tray program for one answer: it prints one line of JSON and exits, without ever showing an icon. */
async function ask<T>(exe: string, args: string[]): Promise<{ code: number; result: T }> {
  try {
    const { stdout } = await run(exe, args, { timeout: 20_000, windowsHide: true })
    return { code: 0, result: JSON.parse(stdout.trim()) as T }
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    return { code: e.code ?? -1, result: JSON.parse((e.stdout ?? '{}').trim() || '{}') as T }
  }
}

/** Builds its icon and menu, reads the app once, and says what it would show. */
const selfTest = (exe: string, port: number, logDir?: string) => ask<SelfTest>(exe, ['--selftest', '--port', String(port), ...(logDir ? ['--logs', logDir] : [])])

/** What the Quit menu item does, from the command line: the same request the dashboard's Quit button sends. */
const quitWith = (exe: string, port: number) => ask<{ ok: boolean; message: string }>(exe, ['--quit', '--port', String(port)])

/** Runs `fn` against a copy of the demo with no window and no tray icon, and always shuts it down after. */
async function withDemoApp<T>(fn: (app: { port: number; logDir: string }) => Promise<T>): Promise<T> {
  const port = randomPort()
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-tray-app-'))
  const pidFile = pidFilePath(logDir, port)
  try {
    await run(process.execPath, ['src/main.ts', '--demo', '--background', '--port', String(port)], {
      cwd: root,
      timeout: 25_000,
      env: { ...process.env, AUTOSTEP_LOG_DIR: logDir, AUTOSTEP_NO_TRAY: '1' }
    })
    return await fn({ port, logDir })
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
    try {
      fs.rmSync(logDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch {
      // see above: clearing up is not a test
    }
  }
}

/** The tray program running for real but without an icon, so a test can watch when it closes. */
function startHidden(exe: string, args: string[]): { child: ChildProcess; closed: Promise<number> } {
  const child = spawn(exe, ['--hidden', ...args], { stdio: 'ignore', windowsHide: true })
  const closed = new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? -1)))
  return { child, closed }
}

const within = <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([promise, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))])

// The tests build into a temp folder and never show an icon, so running them doesn't touch the real tray.
describe('tray program', { skip: process.platform !== 'win32' }, () => {
  let outDir = ''
  let exe = ''

  before(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-tray-'))
    exe = (await buildTray(source, outDir)).exe
  })
  // Windows can still hold the freshly built program for a moment (a virus scan, a copy that is closing), so removing the folder retries.
  after(() => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch {
      // Still locked after all that: the folder is in the temp folder and goes with it. Clearing up is not a test.
    }
  })

  it('finds the compiler that comes with Windows', () => {
    assert.match(findCompiler() ?? '', /csc\.exe$/i)
  })

  it('builds the program once and reuses it until the source changes', async () => {
    assert.equal(path.basename(exe), TRAY_EXE)
    assert.ok(fs.statSync(exe).size > 10_000, 'a real program was built')

    const again = await buildTray(source, outDir)
    assert.deepEqual({ exe: again.exe, built: again.built }, { exe, built: false })

    const changed = path.join(outDir, 'changed.cs')
    fs.writeFileSync(changed, `${fs.readFileSync(source, 'utf8')}\n// changed\n`)
    const rebuilt = await buildTray(changed, outDir)
    assert.equal(rebuilt.built, true)
    assert.deepEqual(
      fs.readdirSync(outDir).filter((n) => n.includes('.build-') || n.includes('.old-')),
      [],
      'no temporary copies are left behind'
    )
    await buildTray(source, outDir) // put the real one back for the tests below
  })

  it('builds from a path written with forward slashes, which the compiler reads wrongly as it is', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-tray-slash-'))
    try {
      const result = await buildTray(source.split(path.sep).join('/'), dir.split(path.sep).join('/'))
      assert.equal(result.built, true)
      assert.ok(fs.existsSync(path.join(dir, TRAY_EXE)))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports what the compiler said when the source is broken, and leaves nothing behind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-tray-bad-'))
    try {
      const bad = path.join(dir, 'bad.cs')
      fs.writeFileSync(bad, 'class Broken { this is not C# }')
      await assert.rejects(buildTray(bad, dir), /did not build/)
      assert.deepEqual(fs.readdirSync(dir), ['bad.cs'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shows what the running app reports, and the menu you get', async () => {
    await withDemoApp(async ({ port, logDir }) => {
      // The first reading arrives a moment after the app starts; until then it says it is waiting for data.
      let tray = await getTray(port)
      for (let i = 0; i < 40 && tray.level === 'attention'; i++) {
        await new Promise((r) => setTimeout(r, 250))
        tray = await getTray(port)
      }
      assert.deepEqual(Object.keys(tray).sort(), ['level', 'line', 'tip', 'title'])
      assert.ok(['ok', 'busy'].includes(tray.level), `${tray.level}: ${tray.line}`)
      assert.equal(tray.title, 'Auto Step Climb - Demo')

      const { code, result } = await selfTest(exe, port, logDir)
      assert.equal(code, 0, JSON.stringify(result))
      assert.equal(result.ok, true)
      assert.match(result.tip ?? '', /^Auto Step Climb \(Demo\): /)
      assert.ok((result.tip ?? '').length <= 63)
      assert.equal(result.icon, '32x32')
      assert.deepEqual(result.menu, [result.title, result.line, 'Open dashboard', 'Open log folder', 'Quit Auto Step Climb'])
      assert.equal(result.title, 'Auto Step Climb - Demo')
    })
  })

  it('leaves out the log folder item when it is not told where the logs are', async () => {
    await withDemoApp(async ({ port }) => {
      const { result } = await selfTest(exe, port)
      assert.equal(result.ok, true)
      assert.equal(result.menu?.includes('Open log folder'), false)
    })
  })

  it('draws the icon with a dot in the colour of each status', async () => {
    const dir = path.join(outDir, 'icons')
    await run(exe, ['--render', dir], { timeout: 20_000, windowsHide: true })
    const expected: Record<string, [number, number, number]> = {
      ok: [0x3d, 0xdc, 0x6e], // green
      busy: [0x38, 0xd5, 0xff], // cyan
      attention: [0xff, 0xb0, 0x20], // amber
      problem: [0xff, 0x5c, 0x5c], // red
      off: [0x8a, 0x94, 0xa3] // grey
    }
    for (const [level, [r, g, b]] of Object.entries(expected)) {
      const pic = decodePng(fs.readFileSync(path.join(dir, `${level}.png`)))
      assert.deepEqual([pic.width, pic.height], [32, 32], level)
      assert.deepEqual(pixel(pic, 24, 9), [r, g, b, 255], `${level}: the middle of the dot`)
      assert.deepEqual(pixel(pic, 16, 29), [0x0d, 0x12, 0x18, 255], `${level}: the dark tile behind`)
      assert.equal(pixel(pic, 0, 0)[3], 0, `${level}: the corner is see-through`)
    }
    // every colour is a different picture, so one level can't be drawn as another
    const dots = new Set(Object.keys(expected).map((level) => pixel(decodePng(fs.readFileSync(path.join(dir, `${level}.png`))), 24, 9).join()))
    assert.equal(dots.size, 5)
  })

  it('quits the app the way its menu item does, and the app closes', async () => {
    await withDemoApp(async ({ port }) => {
      assert.ok(await probe(port))
      const { code, result } = await quitWith(exe, port)
      assert.equal(code, 0, JSON.stringify(result))
      assert.equal(result.ok, true)
      for (let i = 0; i < 40 && (await probe(port, 200)); i++) await new Promise((r) => setTimeout(r, 250))
      assert.equal(await probe(port, 300), null, 'the app has closed')
    })
  })

  it('sends the headers the app requires, and passes on the reason when the app refuses', async () => {
    const port = randomPort()
    const server = http.createServer((req, res) => {
      const ok = req.method === 'POST' && req.url === '/api/quit' && req.headers['x-autostep'] === '1' && String(req.headers['content-type']).startsWith('application/json')
      res.writeHead(ok ? 400 : 403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: ok ? 'A step climb is in progress - press Stop first' : 'missing required headers' }))
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    try {
      const { code, result } = await quitWith(exe, port)
      assert.equal(code, 1)
      assert.deepEqual(result, { ok: false, message: 'A step climb is in progress - press Stop first' })
    } finally {
      server.close()
    }
  })

  it('says so when there is nothing to quit', async () => {
    const { code, result } = await quitWith(exe, randomPort())
    assert.equal(code, 1)
    assert.equal(result.ok, false)
    assert.ok(result.message)
  })

  it('says so, and exits with an error, when nothing answers', async () => {
    const port = randomPort()
    assert.equal(await probe(port, 300), null)
    const { code, result } = await selfTest(exe, port)
    assert.equal(code, 1)
    assert.equal(result.ok, false)
    assert.ok(result.error)
  })

  it('refuses a missing or invalid port', async () => {
    await assert.rejects(run(exe, ['--selftest'], { timeout: 10_000, windowsHide: true }), (e: { code?: number }) => e.code === 2)
  })

  it('closes within seconds of the app it watches exiting, even while the dashboard still answers', async () => {
    await withDemoApp(async ({ port, logDir }) => {
      const watched = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
      const tray = startHidden(exe, ['--port', String(port), '--pid', String(watched.pid), '--logs', logDir])
      try {
        assert.equal(await within(tray.closed, 2000), 'timeout', 'it stays while the app is running')
        const t0 = Date.now()
        watched.kill()
        assert.equal(await within(tray.closed, 5000), 0, 'it closes once the app has gone')
        assert.ok(Date.now() - t0 < 3000, `it took ${Date.now() - t0} ms`)
        assert.match(fs.readFileSync(path.join(logDir, 'tray.log'), 'utf8'), /closing: the app exited/)
      } finally {
        watched.kill()
        tray.child.kill()
      }
    })
  })

  it('closes by itself some seconds after the app stops answering, when it has no process to watch', async () => {
    await withDemoApp(async ({ port, logDir }) => {
      const tray = startHidden(exe, ['--port', String(port), '--logs', logDir])
      try {
        assert.equal(await within(tray.closed, 2500), 'timeout', 'it stays while the app answers')
        await requestQuit(port)
        assert.equal(await within(tray.closed, 20_000), 0, 'it closes after the app has gone')
        assert.match(fs.readFileSync(path.join(logDir, 'tray.log'), 'utf8'), /closing: the app is gone/)
      } finally {
        tray.child.kill()
      }
    })
  })

  it('closes at once when the process it was told to watch is not running', async () => {
    await withDemoApp(async ({ port, logDir }) => {
      const tray = startHidden(exe, ['--port', String(port), '--pid', '2147483000', '--logs', logDir])
      try {
        assert.equal(await within(tray.closed, 5000), 0)
        assert.match(fs.readFileSync(path.join(logDir, 'tray.log'), 'utf8'), /closing: the app is not running/)
      } finally {
        tray.child.kill()
      }
    })
  })

  it('a second copy for the same app closes at once, so there is one icon per app', async () => {
    await withDemoApp(async ({ port, logDir }) => {
      const first = startHidden(exe, ['--port', String(port), '--logs', logDir])
      try {
        assert.equal(await within(first.closed, 1500), 'timeout')
        const second = startHidden(exe, ['--port', String(port), '--logs', logDir])
        assert.equal(await within(second.closed, 5000), 0)
        assert.equal(first.child.exitCode, null, 'the first one is still there')
      } finally {
        first.child.kill()
      }
    })
  })
})
