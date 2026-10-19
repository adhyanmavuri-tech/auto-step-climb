// Turns the Windows app's TypeScript into the two files Electron runs: out/main.cjs and out/preload.cjs.
//
//   npm run bundle
//
// node-simconnect stays a separate package (it is LGPL, and is shipped as a module the user could replace) and
// Electron's own modules are provided by Electron. Everything else is bundled in.
import fs from 'node:fs'
import path from 'node:path'
import { load, packageVersion, root } from './lib/tools.ts'

interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ errors: unknown[]; warnings: unknown[] }>
}

export async function bundle(): Promise<void> {
  const esbuild = load<Esbuild>('esbuild')
  const out = path.join(root, 'out')
  fs.mkdirSync(out, { recursive: true })
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'electron', 'main.ts')],
    outfile: path.join(out, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // The Node that comes with the Electron the app ships with (Electron 31: Node 20).
    target: 'node20',
    external: ['electron', 'node-simconnect'],
    logLevel: 'warning',
    legalComments: 'none'
  })
  fs.copyFileSync(path.join(root, 'electron', 'preload.cjs'), path.join(out, 'preload.cjs'))
  const kb = (file: string): string => `${(fs.statSync(path.join(out, file)).size / 1024).toFixed(0)} KB`
  console.log(`Bundled out/main.cjs (${kb('main.cjs')}) and out/preload.cjs (${kb('preload.cjs')}) with esbuild ${packageVersion('esbuild')}`)
  if (result.errors.length > 0) throw new Error('The bundle has errors')
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await bundle()
