import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Finds the tools the build uses (esbuild, Electron, electron-builder). They are development dependencies, so after
 * "npm install" they are in this project's node_modules. If you already have them somewhere else (another project
 * that builds an Electron app, say), set AUTOSTEP_TOOLS_DIR to that project's folder and nothing needs to be
 * installed or downloaded.
 */

export const root = path.resolve(import.meta.dirname, '..', '..')
const require = createRequire(path.join(root, 'package.json'))

/** The folder of an installed package. */
export function packageDir(name: string): string {
  const places = [root, ...(process.env.AUTOSTEP_TOOLS_DIR ? [path.resolve(process.env.AUTOSTEP_TOOLS_DIR)] : [])]
  for (const place of places) {
    try {
      return path.dirname(require.resolve(`${name}/package.json`, { paths: [place] }))
    } catch {
      // not there: try the next place
    }
  }
  throw new Error(`${name} is not installed. Run "npm install", or set AUTOSTEP_TOOLS_DIR to a project folder whose node_modules has it.`)
}

/** A package's version, from its package.json. */
export function packageVersion(name: string): string {
  return (require(path.join(packageDir(name), 'package.json')) as { version: string }).version
}

/** Loads an installed CommonJS package. */
export function load<T>(name: string): T {
  return require(packageDir(name)) as T
}
