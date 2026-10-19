import fs from 'node:fs'
import path from 'node:path'

/** One value to store in the settings file: where it goes (`['engine', 'atcFirst']`) and what it is. */
export interface ConfigValue {
  path: readonly string[]
  value: unknown
}

export type SaveResult = { ok: true } | { ok: false; reason: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Notepad can save a file with a byte order mark in front, which JSON.parse refuses. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/**
 * Writes settings into the settings file (config.json) without disturbing the rest of it: every other
 * key stays as it was, so a setting changed in the window never throws away what the user typed by hand.
 * A file that is not valid JSON is left alone, because overwriting it would lose whatever it held.
 * The new text goes into a temporary file first and replaces the old one in a single step, so a crash
 * or a power cut can never leave half a file.
 */
export function saveConfigValues(file: string, values: ConfigValue[]): SaveResult {
  let root: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))
    } catch (err) {
      return {
        ok: false,
        reason: `${file} is not valid JSON (${err instanceof Error ? err.message : String(err)}), so the setting was not saved. Fix the file or delete it.`
      }
    }
    if (!isRecord(parsed)) return { ok: false, reason: `${file} does not hold a JSON object, so the setting was not saved.` }
    root = parsed
  }

  for (const { path: keys, value } of values) {
    if (keys.length === 0) continue
    let node = root
    for (const key of keys.slice(0, -1)) {
      const next = node[key]
      if (isRecord(next)) {
        node = next
      } else {
        const fresh: Record<string, unknown> = {}
        node[key] = fresh
        node = fresh
      }
    }
    node[keys[keys.length - 1]!] = value
  }

  const tmp = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return { ok: true }
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // nothing more to clean up
    }
    return { ok: false, reason: `Could not write ${file}: ${err instanceof Error ? err.message : String(err)}` }
  }
}
