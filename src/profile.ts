import fs from 'node:fs'
import path from 'node:path'

/**
 * Everything aircraft-specific lives in a profile (profiles/*.json): which SimVars show the FCU
 * altitude, and which input events or key events set it and start a climb. The step logic itself
 * is the same for every aircraft.
 *
 * knob   - the altitude is turned click by click (iniBuilds-style input events). The app reads the
 *          FCU back after every click.
 * direct - the altitude is set in one action (for example a SimConnect key event that takes feet).
 */
export type ControlKind = 'knob' | 'direct'

/** A number, or "altitudeFt" to pass the target altitude in feet. */
export type ActionValue = number | 'altitudeFt'

/** Set an input event (the A330's FCU controls are these). */
export interface InputEventAction {
  inputEvent: string
  value: ActionValue
  /** Sent pulseMs later, for push buttons that want a 1 and then a 0. */
  releaseValue?: number
  pulseMs?: number
}

/** Send a SimConnect key event by name, for example "AP_ALT_VAR_SET_ENGLISH". */
export interface KeyEventAction {
  keyEvent: string
  data?: ActionValue
}

export type ProfileAction = InputEventAction | KeyEventAction

export interface AircraftProfile {
  name: string
  /** Regular expression (case-insensitive) matched against the aircraft TITLE. */
  titlePattern: string
  /** True once someone has confirmed on the real aircraft that these controls work. */
  verified: boolean
  control: ControlKind
  simVars: {
    /** What the FCU altitude window shows. */
    fcuSelectedFt: string
    /** What the autopilot is flying to. */
    apTargetFt: string
  }
  /** control = knob: the ALT rotary. */
  knob?: { inputEvent: string; upValue: number; downValue: number }
  /** control = direct: sets the selected altitude (value or data = feet). */
  setAltitude?: ProfileAction
  /** Start the climb after the altitude is set: managed (push) or open (pull). */
  engage: { managed: ProfileAction[]; open: ProfileAction[] }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function str(obj: unknown, key: string, where: string): string {
  const v = isRecord(obj) ? obj[key] : undefined
  if (typeof v !== 'string' || v === '') throw new Error(`${where}.${key} must be a non-empty string`)
  return v
}

function numField(obj: unknown, key: string, where: string): number {
  const v = isRecord(obj) ? obj[key] : undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where}.${key} must be a number`)
  return v
}

function actionValue(v: unknown, where: string): ActionValue {
  if (v === 'altitudeFt' || (typeof v === 'number' && Number.isFinite(v))) return v
  throw new Error(`${where} must be a number or "altitudeFt"`)
}

function parseAction(raw: unknown, where: string): ProfileAction {
  if (!isRecord(raw)) throw new Error(`${where} must be an object`)
  if (raw.inputEvent !== undefined) {
    const action: InputEventAction = { inputEvent: str(raw, 'inputEvent', where), value: actionValue(raw.value, `${where}.value`) }
    if (raw.releaseValue !== undefined) action.releaseValue = numField(raw, 'releaseValue', where)
    if (raw.pulseMs !== undefined) action.pulseMs = numField(raw, 'pulseMs', where)
    return action
  }
  if (raw.keyEvent !== undefined) {
    const action: KeyEventAction = { keyEvent: str(raw, 'keyEvent', where) }
    if (raw.data !== undefined) action.data = actionValue(raw.data, `${where}.data`)
    return action
  }
  throw new Error(`${where} needs "inputEvent" or "keyEvent"`)
}

function parseActions(raw: unknown, where: string, required: boolean): ProfileAction[] {
  if (raw === undefined && !required) return []
  if (!Array.isArray(raw) || (required && raw.length === 0)) {
    throw new Error(`${where} must be a list${required ? ' with at least one action' : ''}`)
  }
  return raw.map((a, i) => parseAction(a, `${where}[${i}]`))
}

export function parseProfile(raw: unknown, where = 'profile'): AircraftProfile {
  if (!isRecord(raw)) throw new Error(`${where}: expected a JSON object`)
  const control = raw.control
  if (control !== 'knob' && control !== 'direct') throw new Error(`${where}.control must be "knob" or "direct"`)
  if (!isRecord(raw.engage)) throw new Error(`${where}.engage is required`)

  const profile: AircraftProfile = {
    name: str(raw, 'name', where),
    titlePattern: str(raw, 'titlePattern', where),
    verified: raw.verified === true,
    control,
    simVars: {
      fcuSelectedFt: str(raw.simVars, 'fcuSelectedFt', `${where}.simVars`),
      apTargetFt: str(raw.simVars, 'apTargetFt', `${where}.simVars`)
    },
    engage: {
      managed: parseActions(raw.engage.managed, `${where}.engage.managed`, true),
      open: parseActions(raw.engage.open, `${where}.engage.open`, false)
    }
  }
  if (control === 'knob') {
    profile.knob = {
      inputEvent: str(raw.knob, 'inputEvent', `${where}.knob`),
      upValue: numField(raw.knob, 'upValue', `${where}.knob`),
      downValue: numField(raw.knob, 'downValue', `${where}.knob`)
    }
  } else {
    if (raw.setAltitude === undefined) throw new Error(`${where}.setAltitude is required for control "direct"`)
    profile.setAltitude = parseAction(raw.setAltitude, `${where}.setAltitude`)
  }
  new RegExp(profile.titlePattern, 'i') // throws on a bad pattern
  return profile
}

/**
 * Loads every profiles/*.json. Files starting with "_" (templates, drafts) are skipped, and one
 * broken file is reported but doesn't stop the others.
 */
export function loadProfiles(dir: string): { profiles: AircraftProfile[]; errors: string[] } {
  const profiles: AircraftProfile[] = []
  const errors: string[] = []
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  } catch {
    return { profiles, errors: [`${dir}: cannot read the profiles folder`] }
  }
  for (const file of files) {
    try {
      profiles.push(parseProfile(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file))
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { profiles, errors }
}

/** The profile whose title pattern matches, preferring the more specific (longer) pattern. */
export function pickProfile(profiles: AircraftProfile[], title: string): AircraftProfile | null {
  let best: AircraftProfile | null = null
  for (const p of profiles) {
    if (!new RegExp(p.titlePattern, 'i').test(title)) continue
    if (!best || p.titlePattern.length > best.titlePattern.length) best = p
  }
  return best
}

/** Every input event name the profile relies on, so the adapter can check the aircraft has them. */
export function inputEventsUsed(profile: AircraftProfile): string[] {
  const names = new Set<string>()
  const add = (a: ProfileAction | undefined): void => {
    if (a && 'inputEvent' in a) names.add(a.inputEvent)
  }
  if (profile.knob) names.add(profile.knob.inputEvent)
  add(profile.setAltitude)
  profile.engage.managed.forEach(add)
  profile.engage.open.forEach(add)
  return [...names]
}
