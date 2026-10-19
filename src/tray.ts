import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LogEntry } from './types.ts'

const run = promisify(execFile)

/**
 * The tray icon, for a copy running with no window. It is a small separate program (tray/*.cs) so the
 * app shows up in the tray and in Task Manager as "Auto Step Climb". It is built on first use with the
 * C# compiler that ships with Windows, so nothing has to be installed, and it only ever talks to this
 * app's own dashboard on 127.0.0.1. The app runs the same without it.
 */

export const TRAY_EXE = 'AutoStepClimb.exe'

/** The C# compiler that comes with Windows (.NET Framework 4). */
export function findCompiler(env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== 'win32') return null
  const windir = env.SystemRoot ?? env.windir ?? 'C:\\Windows'
  for (const flavour of ['Framework64', 'Framework']) {
    const exe = path.join(windir, 'Microsoft.NET', flavour, 'v4.0.30319', 'csc.exe')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

export interface BuildResult {
  exe: string
  /** False when an up-to-date copy was already there. */
  built: boolean
}

/** Compiles the tray program into `outDir`, unless an up-to-date copy is already there. */
export async function buildTray(source: string, out: string): Promise<BuildResult> {
  // The compiler reads a path with forward slashes in it wrongly, so hand it Windows paths only.
  const sourceFile = path.resolve(source)
  const outDir = path.resolve(out)
  const hash = createHash('sha1').update(fs.readFileSync(sourceFile)).digest('hex')
  const exe = path.join(outDir, TRAY_EXE)
  const hashFile = `${exe}.hash`
  const current = (): boolean => fs.existsSync(exe) && readText(hashFile) === hash
  if (current()) return { exe, built: false }

  const csc = findCompiler()
  if (!csc) throw new Error('the C# compiler that comes with Windows (csc.exe) was not found')
  fs.mkdirSync(outDir, { recursive: true })
  const tmp = path.join(outDir, `AutoStepClimb.build-${process.pid}.exe`)
  try {
    await run(
      csc,
      ['/nologo', '/target:winexe', '/optimize+', `/out:${tmp}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', sourceFile],
      { windowsHide: true, timeout: 60_000 }
    )
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    const detail = (err as { stdout?: string }).stdout || (err instanceof Error ? err.message : String(err))
    throw new Error(`the tray program did not build: ${detail.trim().split('\n').slice(0, 3).join(' ')}`)
  }

  // A running copy can't be overwritten but it can be renamed, so an update never waits for it to close.
  try {
    if (fs.existsSync(exe)) fs.renameSync(exe, path.join(outDir, `AutoStepClimb.old-${Date.now()}.exe`))
    fs.renameSync(tmp, exe)
    fs.writeFileSync(hashFile, hash)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    if (!current()) throw err // unless another copy of the app installed the same build a moment ago
  }
  for (const name of fs.readdirSync(outDir)) {
    if (name.startsWith('AutoStepClimb.old-')) {
      try {
        fs.rmSync(path.join(outDir, name), { force: true })
      } catch {
        // still running: it is removed next time
      }
    }
  }
  return { exe, built: true }
}

export interface StartTrayOptions {
  /** The dashboard's port: the icon reads and quits that copy. */
  port: number
  logDir: string
  /** The project folder, where tray/ (the source) and bin/ (the built program) live. */
  root: string
  log?: (level: LogEntry['level'], text: string) => void
}

export type StartTrayResult = { ok: true; pid: number | undefined; built: boolean } | { ok: false; reason: string }

/** Builds the tray program if needed and starts it with no window. It closes itself when this app does. */
export async function startTray(opts: StartTrayOptions): Promise<StartTrayResult> {
  if (process.platform !== 'win32') return { ok: false, reason: 'the tray icon is for Windows' }
  try {
    const { exe, built } = await buildTray(path.join(opts.root, 'tray', 'AutoStepClimbTray.cs'), path.join(opts.root, 'bin'))
    // --pid: the icon closes the moment this process ends, without waiting for the dashboard to stop answering.
    const child = spawn(exe, ['--port', String(opts.port), '--pid', String(process.pid), '--logs', opts.logDir], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (err) => opts.log?.('warn', `The tray icon could not start: ${err.message}`)) // for example blocked by antivirus
    child.unref()
    return { ok: true, pid: child.pid, built }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
