import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { stripBom } from './config-write.ts'

/**
 * What the Windows app remembers between runs, apart from the settings the user can read in config.json:
 * whether the first-run question has been asked, and which aircraft profiles have passed a control test.
 */
export interface AppState {
  /** The first-run question (start with Windows?) has been asked, so it is not asked again. */
  firstRunDone: boolean
  /** Profile name -> fingerprint of the profile file when its control test passed. */
  controlTested: Record<string, string>
}

export const EMPTY_APP_STATE: AppState = { firstRunDone: false, controlTested: {} }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads the state file. A missing or damaged file is the same as a fresh install. */
export function loadAppState(file: string): AppState {
  try {
    const raw: unknown = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))
    if (!isRecord(raw)) return { ...EMPTY_APP_STATE, controlTested: {} }
    const tested: Record<string, string> = {}
    if (isRecord(raw.controlTested)) {
      for (const [name, print] of Object.entries(raw.controlTested)) if (typeof print === 'string') tested[name] = print
    }
    return { firstRunDone: raw.firstRunDone === true, controlTested: tested }
  } catch {
    return { ...EMPTY_APP_STATE, controlTested: {} }
  }
}

/** Saves the state file. Failing to save is not worth stopping for: the worst case is being asked again. */
export function saveAppState(file: string, state: AppState): boolean {
  const tmp = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // nothing more to clean up
    }
    return false
  }
}

/**
 * A short fingerprint of an aircraft profile. A passed control test belongs to the profile as it was
 * then: edit the profile (or get a new one with an update) and the test has to be passed again.
 */
export function profileFingerprint(profile: unknown): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex').slice(0, 16)
}
