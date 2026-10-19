// Stops the app, wherever it is running (in the background or in a console).
//
//   npm run stop
//   npm run stop -- --port=8787
//   npm run stop -- --force     (kills it by process id if it does not answer or will not quit)
//
// It asks the dashboard to quit, which is refused while a step is in progress: press Stop on the
// dashboard first, then quit.
import path from 'node:path'
import { isAlive, pidFilePath, probe, readPidFile, removePidFile, requestQuit } from '../src/background.ts'
import { loadConfig } from '../src/config.ts'

const root = path.resolve(import.meta.dirname, '..')
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const force = process.argv.includes('--force')
const port = Number(arg('port') ?? loadConfig(path.join(root, 'config.json')).config.port)
const pidFile = pidFilePath(process.env.AUTOSTEP_LOG_DIR ?? path.join(root, 'logs'), port)

/** Returns the exit code. */
function forceKill(): number {
  const pid = readPidFile(pidFile)
  if (pid === null || !isAlive(pid)) {
    console.log('Nothing to kill: no running copy was found.')
    removePidFile(pidFile)
    return 0
  }
  process.kill(pid)
  removePidFile(pidFile)
  console.log(`Killed process ${pid}. Check the FCU yourself if a step was in progress.`)
  return 0
}

async function main(): Promise<number> {
  if (!(await probe(port))) {
    if (force) return forceKill()
    console.log(`Auto Step Climb is not running on port ${port}.`)
    removePidFile(pidFile)
    return 0
  }

  const quit = await requestQuit(port)
  if (!quit.ok) {
    console.error(`It did not quit: ${quit.message}`)
    return force ? forceKill() : 1
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (!(await probe(port, 400))) {
      console.log('Stopped.')
      return 0
    }
  }
  console.error('It was asked to quit but is still answering.')
  return force ? forceKill() : 1
}

// Not process.exit(): on Windows, exiting while a connection is still closing crashes Node with a libuv assertion
// ("UV_HANDLE_CLOSING"), so the exit code is set and the program ends by itself.
process.exitCode = await main()
