// Says whether the app is running and what it is doing. Read-only.
//
//   npm run status
//   npm run status -- --port=8787
import path from 'node:path'
import { probe } from '../src/background.ts'
import { loadConfig } from '../src/config.ts'

const root = path.resolve(import.meta.dirname, '..')
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const port = Number(arg('port') ?? loadConfig(path.join(root, 'config.json')).config.port)

const state = await probe(port)
if (!state) {
  console.log(`Auto Step Climb is not running on port ${port}. Start it with start-background.bat or start-live-background.bat.`)
  // Not process.exit(): on Windows, exiting while the refused connection is still closing crashes Node with a libuv assertion.
  process.exitCode = 1
} else {
  const mode = state.app.mode === 'live' ? 'LIVE' : state.app.mode === 'dry-run' ? 'watching only' : state.app.mode
  console.log(`Running (${mode}), version ${state.app.version}. Dashboard: http://127.0.0.1:${port}`)
  console.log(`Sim: ${state.sim.connected ? `connected${state.sim.title ? `, ${state.sim.title}` : ''}` : 'not connected'}`)
  if (state.sim.gate?.reason) console.log(`Closing: ${state.sim.gate.reason}`)
  console.log(`Now: ${state.engine.message}`)
  for (const s of state.engine.steps) console.log(`  ${s.step.label.padEnd(18)} ${s.status}${s.note ? `  (${s.note})` : ''}`)
}
