// Builds the Windows installer, and the zip for flightsim.to that holds it.
//
//   npm run dist
//
// Result: release\AutoStepClimb-Setup-<version>.exe and release\AutoStepClimb-<version>.zip
//
// Nothing is downloaded unless you ask for it: Electron comes from the Electron that is already installed, and
// the installer tools (NSIS) come from electron-builder's own cache. If something is missing from the cache the
// build stops and says so; set AUTOSTEP_ALLOW_DOWNLOADS=1 to let it fetch what it needs.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { issuesUrl } from '../src/support.ts'
import { bundle } from './bundle.ts'
import { packageDir, packageVersion, root } from './lib/tools.ts'

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
const version = pkg.version
const release = path.join(root, 'release')

await bundle()

const env: NodeJS.ProcessEnv = { ...process.env }
if (process.env.AUTOSTEP_ALLOW_DOWNLOADS !== '1') {
  // A proxy that is not there makes any download fail at once, instead of succeeding quietly.
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) env[name] = 'http://127.0.0.1:9'
  delete env.NO_PROXY
  delete env.no_proxy
}

const builder = path.join(packageDir('electron-builder'), 'cli.js')
const built = spawnSync(
  process.execPath,
  [
    builder,
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
    `-c.electronVersion=${packageVersion('electron')}`,
    `-c.electronDist=${path.join(packageDir('electron'), 'dist')}`
  ],
  { cwd: root, env, stdio: 'inherit' }
)
if (built.status !== 0) {
  console.error('\nelectron-builder did not finish. If it says it could not download something, the tool is not in its cache yet: run again with AUTOSTEP_ALLOW_DOWNLOADS=1.')
  process.exit(built.status ?? 1)
}

// The zip: flightsim.to takes archives, not installers. It holds the installer and the short texts that go with it.
const installer = `AutoStepClimb-Setup-${version}.exe`
if (!fs.existsSync(path.join(release, installer))) throw new Error(`${installer} was not built`)
const staging = path.join(release, `AutoStepClimb-${version}`)
fs.rmSync(staging, { recursive: true, force: true })
fs.mkdirSync(staging, { recursive: true })
fs.copyFileSync(path.join(release, installer), path.join(staging, installer))
fs.copyFileSync(path.join(root, 'docs', 'DOWNLOAD-README.txt'), path.join(staging, 'README.txt'))
fs.copyFileSync(path.join(root, 'docs', 'USER-GUIDE.md'), path.join(staging, 'USER-GUIDE.txt'))
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE.txt'))
fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(staging, 'THIRD-PARTY-NOTICES.txt'))
fs.copyFileSync(path.join(root, 'licenses', 'GPL-3.0.txt'), path.join(staging, 'GPL-3.0.txt'))
const zip =path.join(release, `AutoStepClimb-${version}.zip`)
fs.rmSync(zip, { force: true })
// tar.exe comes with Windows 10 and 11 and writes a zip when the name ends in .zip. Windows' own copy is used by its
// full path: a tar from Git or MSYS earlier on the PATH reads "C:" as the name of another computer.
const windowsTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const packed = spawnSync(windowsTar, ['-a', '-c', '-f', zip, '-C', staging, '.'], { stdio: 'inherit' })
if (packed.status !== 0) throw new Error('Could not make the zip')
fs.rmSync(staging, { recursive: true, force: true })

// The hashes people can check what they downloaded against, written into the listing so they never go stale.
const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const zipHash = sha256(zip)
const exeHash = sha256(path.join(release, installer))
const listing = path.join(root, 'docs', 'FLIGHTSIM-TO.md')
if (fs.existsSync(listing)) {
  const text = fs.readFileSync(listing, 'utf8')
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` // the builder's own date, not UTC's
  const next = text
    .replace(/^(zip\s+)[0-9a-f]{64}$/m, `$1${zipHash}`)
    .replace(/^(installer\s+)[0-9a-f]{64}$/m, `$1${exeHash}`)
    .replace(/\(from the build on \d{4}-\d\d-\d\d\)/, `(from the build on ${today})`)
  if (next !== text) fs.writeFileSync(listing, next)
}

const mb = (file: string): string => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`
console.log(`\nInstaller: ${path.join(release, installer)} (${mb(path.join(release, installer))})`)
console.log(`Zip:       ${zip} (${mb(zip)})`)
console.log(`SHA-256 of the zip:       ${zipHash}`)
console.log(`SHA-256 of the installer: ${exeHash}`)
console.log('(written into docs/FLIGHTSIM-TO.md)')
if (issuesUrl() === '') console.log('\nNOTE: no bug report page is set in src/support.ts, so the window has "Copy report" but no "Report a problem" button yet (docs/GITHUB-SETUP.md).')
