import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

/**
 * Helpers for running the app with no window: start it detached, ask whether it is running, and
 * stop it. Everything goes through the dashboard's own local API, so these work the same whether it
 * was started in the background or in a console, and they never need to guess a process id.
 */

/** The parts of the dashboard's state the commands read. */
export interface DashboardState {
  app: { mode: string; port: number; version: string }
  sim: { connected: boolean; title: string | null; gate?: { verdict: string; reason: string | null } | null }
  engine: { phase: string; message: string; steps: { step: { label: string }; status: string; note: string }[] }
}

export const pidFilePath = (logDir: string, port: number): string => path.join(logDir, `autostep-${port}.pid`)

export function writePidFile(file: string, pid: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, String(pid))
  } catch {
    // a convenience for --force; the app runs without it
  }
}

export function readPidFile(file: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function removePidFile(file: string): void {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // nothing to remove
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * One request to the dashboard on this PC, with a deadline for the whole thing. It uses node:http with no
 * keep-alive rather than fetch: on Windows, a program that calls process.exit() soon after a fetch can die
 * with a libuv assertion ("UV_HANDLE_CLOSING", exit code 0xC0000409), and the launcher, stop and status
 * all exit right after talking to the dashboard.
 */
function call(port: number, method: 'GET' | 'POST', path: string, timeoutMs: number, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Autostep': '1', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      }
    )
    const timer = setTimeout(() => req.destroy(new Error('timed out')), timeoutMs)
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** The dashboard's state, or null when nothing of ours answers on that port. */
export async function probe(port: number, timeoutMs = 1500): Promise<DashboardState | null> {
  try {
    const res = await call(port, 'GET', '/api/state', timeoutMs)
    if (res.status !== 200) return null
    const data: unknown = JSON.parse(res.text)
    if (typeof data !== 'object' || data === null || !('app' in data) || !('engine' in data)) return null
    return data as DashboardState
  } catch {
    return null
  }
}

/** Asks the running app to quit. It refuses while a step is in progress, and says so. */
export async function requestQuit(port: number, timeoutMs = 4000): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await call(port, 'POST', '/api/quit', timeoutMs, '{}')
    const body = JSON.parse(res.text) as { ok?: boolean; result?: unknown; error?: unknown }
    return body.ok === true ? { ok: true, message: String(body.result ?? 'Closing') } : { ok: false, message: String(body.error ?? 'refused') }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Starts `script` again as its own process with no window. It keeps running after this one exits. */
export function launchDetached(script: string, args: string[], cwd: string): number | undefined {
  const child = spawn(process.execPath, [...process.execArgv, script, ...args], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  return child.pid
}

/** Opens a page in the default browser. */
export function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {
      // no browser to open: the address is printed anyway
    })
    child.unref()
  } catch {
    // same
  }
}
