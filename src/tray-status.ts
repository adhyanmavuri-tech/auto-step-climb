import type { EngineStatus } from './engine.ts'

/**
 * What the tray icon shows. The icon is a small separate program that only reads this from the app's
 * own dashboard (GET /api/tray), so the wording and the colour are decided here, where they are tested.
 */
export type TrayLevel = 'ok' | 'busy' | 'attention' | 'problem' | 'off'

export interface TrayStatus {
  /** The colour of the icon's dot: green ok, cyan busy, amber attention, red problem, grey off. */
  level: TrayLevel
  /** The icon's hover text. Windows shows at most 63 characters of it. */
  tip: string
  /** The menu's first line: the app and its mode. */
  title: string
  /** The menu's second line: what it is doing. */
  line: string
}

export interface TrayInput {
  mode: 'demo' | 'preview' | 'live' | 'dry-run'
  sim: { connected: boolean; hasData: boolean; aircraftOk: boolean }
  engine: Pick<EngineStatus, 'phase' | 'message' | 'enabled' | 'steps'>
  planError: string | null
  /** Set once the app has decided to close (the loaded aircraft is not supported): a few words on why. */
  closing?: string | null
}

const MODE_LABEL: Record<TrayInput['mode'], string> = { live: 'Live', 'dry-run': 'Watching only', demo: 'Demo', preview: 'Preview' }

/** Windows shows at most 63 characters in an icon's hover text. */
export const TIP_MAX = 63

/** The phases where the app is working the FCU or is about to. */
const BUSY = new Set<string>(['armed', 'setting-fcu', 'asking-atc', 'engaging', 'climbing', 'descending', 'restoring'])

export function trayStatus(input: TrayInput): TrayStatus {
  const { sim, engine } = input
  const failed = engine.steps.find((s) => s.status === 'failed')

  let level: TrayLevel
  let line: string
  if (input.closing) {
    level = 'attention'
    line = `Closing: ${input.closing}`
  } else if (!sim.connected) {
    level = 'attention'
    line = 'Waiting for the sim'
  } else if (!sim.hasData) {
    level = 'attention'
    line = 'Waiting for aircraft data'
  } else if (!sim.aircraftOk) {
    level = 'attention'
    line = 'No supported aircraft loaded'
  } else if (BUSY.has(engine.phase)) {
    level = 'busy'
    line = engine.message
  } else if (engine.phase === 'confirming') {
    // Waiting for a click: the one state where somebody has to be there.
    level = 'attention'
    line = engine.message
  } else if (!engine.enabled) {
    level = 'off'
    line = 'Switched off: no steps will be flown'
  } else if (failed) {
    level = 'problem'
    line = `A step failed: ${failed.step.label}`
  } else if (input.planError) {
    level = 'attention'
    line = input.planError
  } else {
    level = 'ok'
    line = engine.message
  }

  const mode = MODE_LABEL[input.mode]
  return { level, tip: fitTip(`Auto Step Climb (${mode}): ${line}`), title: `Auto Step Climb - ${mode}`, line }
}

/** Cuts a hover text to what Windows will show, ending in "..." when something was left off. */
export function fitTip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= TIP_MAX ? one : `${one.slice(0, TIP_MAX - 3).trimEnd()}...`
}
