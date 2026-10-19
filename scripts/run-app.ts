// Runs the Windows app from the source folder, for trying it out.
//
//   npm run app -- --demo           a simulated aircraft; never touches the simulator
//   npm run app -- --preview        your flight plan flown by a simulated aircraft
//   npm run app                     the real thing: it waits for the sim
//
// It bundles first, so what runs is what the code says now. Anything after "--" goes to the app.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { bundle } from './bundle.ts'
import { packageDir, root } from './lib/tools.ts'

await bundle()
const electron = path.join(packageDir('electron'), 'dist', 'electron.exe')
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
