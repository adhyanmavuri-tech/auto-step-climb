import fs from 'node:fs'
import { stripBom } from './config-write.ts'
import { DEFAULT_ENGINE_OPTIONS } from './engine.ts'
import type { EngineOptions } from './engine.ts'

export interface AppConfig {
  simbrief: { username: string; userId: string }
  /** Path to a saved SimBrief OFP (JSON); used instead of fetching when set. */
  planFile: string
  /** Fallback when there is no OFP: climb after this many NM of level cruise. */
  manualSteps: { afterNm: number; toFl: number }[]
  stepAt: 'fix' | 'previous-fix'
  port: number
  /** A tray icon while it runs in the background (Windows). Set false to run with no icon at all. */
  tray: boolean
  /** Where BeyondATC's toolbar connection is. Only used when engine.atcFirst is on. */
  atc: { host: string; port: number }
  /** The Windows app: live control was switched on in its window. The command-line version ignores this and needs --live. */
  live: boolean
  /** The Windows app: open the window by itself when the A330 is at an airport. */
  openWindowAtAirport: boolean
  engine: EngineOptions
}

export const DEFAULT_CONFIG: AppConfig = {
  simbrief: { username: '', userId: '' },
  planFile: '',
  manualSteps: [],
  stepAt: 'previous-fix',
  port: 8787,
  tray: true,
  atc: { host: '127.0.0.1', port: 41716 },
  live: false,
  openWindowAtAirport: true,
  engine: { ...DEFAULT_ENGINE_OPTIONS }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Copy `patch` over `defaults`, keeping only known keys whose type matches. */
function mergeTyped<T extends object>(defaults: T, patch: unknown, where: string, warnings: string[]): T {
  const base = defaults as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  if (!isRecord(patch)) return out as unknown as T
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in base)) {
      warnings.push(`${where}.${key}: unknown setting, ignored`)
      continue
    }
    const expected = typeof base[key]
    if (typeof value !== expected) {
      warnings.push(`${where}.${key}: expected a ${expected}, ignored`)
      continue
    }
    out[key] = value
  }
  return out as unknown as T
}

export function loadConfig(file: string): { config: AppConfig; warnings: string[] } {
  const warnings: string[] = []
  let raw: unknown = {}
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))
    } catch (err) {
      warnings.push(`${file}: not valid JSON (${err instanceof Error ? err.message : String(err)}), using defaults`)
    }
  }
  const r = isRecord(raw) ? raw : {}

  const config: AppConfig = {
    simbrief: mergeTyped(DEFAULT_CONFIG.simbrief, r.simbrief, 'simbrief', warnings),
    planFile: typeof r.planFile === 'string' ? r.planFile : DEFAULT_CONFIG.planFile,
    manualSteps: [],
    stepAt: r.stepAt === 'fix' ? 'fix' : 'previous-fix',
    port: typeof r.port === 'number' && r.port > 0 && r.port < 65536 ? r.port : DEFAULT_CONFIG.port,
    tray: typeof r.tray === 'boolean' ? r.tray : DEFAULT_CONFIG.tray,
    atc: mergeTyped(DEFAULT_CONFIG.atc, r.atc, 'atc', warnings),
    live: typeof r.live === 'boolean' ? r.live : DEFAULT_CONFIG.live,
    openWindowAtAirport: typeof r.openWindowAtAirport === 'boolean' ? r.openWindowAtAirport : DEFAULT_CONFIG.openWindowAtAirport,
    engine: mergeTyped(DEFAULT_CONFIG.engine, r.engine, 'engine', warnings)
  }
  // The ATC program runs on this PC; the app only ever connects to itself.
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.atc.host)) {
    warnings.push('atc.host: only this PC (127.0.0.1) is allowed, ignored')
    config.atc.host = DEFAULT_CONFIG.atc.host
  }
  if (!(config.atc.port > 0 && config.atc.port < 65536)) {
    warnings.push('atc.port: not a valid port, ignored')
    config.atc.port = DEFAULT_CONFIG.atc.port
  }

  if (Array.isArray(r.manualSteps)) {
    for (const s of r.manualSteps) {
      if (isRecord(s) && typeof s.afterNm === 'number' && typeof s.toFl === 'number' && s.afterNm > 0 && s.toFl > 100) {
        config.manualSteps.push({ afterNm: s.afterNm, toFl: s.toFl })
      } else {
        warnings.push(`manualSteps: ignored ${JSON.stringify(s)} (need afterNm > 0 and toFl such as 360)`)
      }
    }
  }
  if (config.engine.climbMode !== 'managed' && config.engine.climbMode !== 'open') {
    warnings.push(`engine.climbMode must be "managed" or "open", using "managed"`)
    config.engine.climbMode = 'managed'
  }
  return { config, warnings }
}
