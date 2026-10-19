/**
 * The text a person pastes into a bug report ("Copy report" in the window). It is built from what the window already
 * shows (the app's state) plus the versions, so it holds nothing that is not on screen or in the log folder, and
 * nothing is sent anywhere by the app: the person decides where it goes. Whatever identifies them is blanked out
 * first: their SimBrief name and ID, their Windows user name and the folders under it.
 */

export interface ReportEnv {
  /** For example "Windows 11 (10.0.26200), x64". */
  os: string
  electron?: string
  node?: string
  /** The installed app, not run from the source folder. */
  installed?: boolean
  uptimeSec?: number
  /** The Windows user name and home folder: blanked out of the whole text. */
  userName?: string
  homeDir?: string
  /** The time of the report (milliseconds). Tests pass a fixed one. */
  now?: number
}

interface LogLine {
  at: number
  level: string
  text: string
}

/** The parts of the app's state (core.getState()) the report reads. Every part is optional: the report copes without. */
export interface ReportState {
  app?: { version?: string; mode?: string; host?: string; startWithWindows?: boolean; confirmEachStep?: boolean }
  sim?: {
    kind?: string
    connected?: boolean
    dataAgeMs?: number | null
    title?: string | null
    aircraftOk?: boolean
    profile?: { name: string; verified: boolean; control: string; tested: boolean } | null
  }
  aircraft?: { altFt: number; vsFpm: number; mach: number; gsKt: number; weightKg: number; fcuSelectedFt: number; apTargetFt: number; onGround: boolean } | null
  engine?: {
    phase?: string
    message?: string
    enabled?: boolean
    live?: boolean
    stepDowns?: boolean
    atcFirst?: boolean
    atcOtherAircraft?: boolean
    askOnly?: boolean
    distToNextNm?: number | null
    crossTrackNm?: number | null
    steps?: { step: { label: string; fromAltFt: number; toAltFt: number }; status: string; note: string }[]
  }
  atc?: { enabled?: boolean; connected?: boolean; autoRespond?: boolean | null; request?: { altFt: number; status: string; note: string } | null }
  plan?: { source: string; edited: boolean; origin: string; destination: string; generatedAt: string | null } | null
  planWarning?: string | null
  planError?: string | null
  settings?: { simbriefUsername?: string; simbriefUserId?: boolean; live?: boolean; confirmEachStep?: boolean; openWindowAtAirport?: boolean } | null
  launch?: { phase?: string; place?: { icao: string | null; name: string | null; nm: number | null } | null } | null
  logs?: LogLine[]
}

export interface ReportOptions {
  /** How many of the newest log lines to include. */
  logLines?: number
  /** What else to blank out wherever it appears, beyond the Windows user name in the environment. */
  secrets?: { simbriefUsername?: string; simbriefUserId?: string }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Blanks out what identifies the person. Names shorter than three characters are left alone: they would wreck the text. */
export function redact(text: string, env: { homeDir?: string; userName?: string }, names: { simbriefUsername?: string; simbriefUserId?: string }): string {
  let out = text
  const swap = (what: string | undefined, to: string): void => {
    const w = what?.trim()
    if (!w || w.length < 3) return
    out = out.replace(new RegExp(escapeRegExp(w), 'gi'), to)
  }
  // The home folder first, in both slash styles, so the user name inside it is not left half replaced.
  if (env.homeDir) {
    swap(env.homeDir, '%USERPROFILE%')
    swap(env.homeDir.replaceAll('\\', '/'), '%USERPROFILE%')
  }
  swap(names.simbriefUsername, '<SimBrief username>')
  swap(names.simbriefUserId, '<SimBrief ID>')
  swap(env.userName, '<Windows user>')
  return out
}

const MODE: Record<string, string> = {
  'dry-run': 'Watching only (nothing is sent to the aircraft)',
  live: 'LIVE (the app operates the FCU)',
  demo: 'Demo (a simulated aircraft)',
  preview: 'Preview (a simulated aircraft flying the plan)'
}

const fl = (ft: number): string => `FL${Math.round(ft / 100)}`
const num = (n: number, digits = 0): string => n.toLocaleString('en-US', { maximumFractionDigits: digits })
const yesNo = (v: boolean | undefined): string => (v === undefined ? 'unknown' : v ? 'yes' : 'no')
const onOff = (v: boolean | undefined): string => (v === undefined ? 'unknown' : v ? 'on' : 'off')

function duration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  if (min < 1) return 'under a minute'
  const h = Math.floor(min / 60)
  return h === 0 ? `${min} min` : `${h} h ${min % 60} min`
}

/** One line of the log as it goes in the report: UTC time, level, text. */
function logLine(l: LogLine): string {
  const when = new Date(l.at).toISOString().slice(0, 19).replace('T', ' ')
  const text = l.text.length > 400 ? `${l.text.slice(0, 400)}...` : l.text
  return `${when} ${l.level.toUpperCase().padEnd(5)} ${text}`
}

export function buildReport(state: ReportState, env: ReportEnv, options: ReportOptions = {}): string {
  const out: string[] = []
  const add = (label: string, value: string): void => {
    out.push(`${label.padEnd(14)}${value}`)
  }

  out.push('AUTO STEP CLIMB: REPORT')
  out.push('Made by the app on this PC. Nothing was sent anywhere. Your SimBrief name and Windows user name are blanked out.')
  out.push('')

  const app = state.app ?? {}
  add('Version', `${app.version ?? 'unknown'} (${env.installed === false ? 'run from the source folder' : 'installed app'}); Electron ${env.electron ?? '?'}, Node ${env.node ?? '?'}`)
  add('Windows', env.os)
  add('Time (UTC)', new Date(env.now ?? Date.now()).toISOString().slice(0, 19).replace('T', ' '))
  if (env.uptimeSec !== undefined) add('Running for', duration(env.uptimeSec))
  add('Mode', MODE[app.mode ?? ''] ?? app.mode ?? 'unknown')
  if (app.startWithWindows !== undefined) add('With Windows', yesNo(app.startWithWindows))
  out.push('')

  const sim = state.sim ?? {}
  add('Sim', sim.kind === 'demo' ? 'simulated (no sim)' : sim.connected ? `connected${sim.dataAgeMs != null ? `, last reading ${num(sim.dataAgeMs / 1000, 1)} s ago` : ''}` : 'not connected')
  add('Aircraft', sim.title ? `"${sim.title}", supported: ${yesNo(sim.aircraftOk)}` : 'none loaded')
  if (sim.profile) add('Profile', `${sim.profile.name}; verified: ${yesNo(sim.profile.verified)}; control test passed: ${yesNo(sim.profile.tested)}; ${sim.profile.control} controls`)
  const a = state.aircraft
  if (a) {
    add('Readings', `${num(a.altFt)} ft, ${num(a.vsFpm)} fpm, Mach ${num(a.mach, 3)}, ${num(a.gsKt)} kt, ${num(a.weightKg / 1000, 1)} t, FCU ${fl(a.fcuSelectedFt)}, AP target ${fl(a.apTargetFt)}, ${a.onGround ? 'on the ground' : 'airborne'}`)
  }
  const place = state.launch?.place
  if (state.launch) add('Launch', `${state.launch.phase ?? 'unknown'}${place ? `, at ${place.icao ?? 'an airport'}${place.name ? ` (${place.name})` : ''}` : ''}`)
  out.push('')

  const e = state.engine ?? {}
  const s = state.settings
  add('Settings', `confirm each step: ${onOff(s?.confirmEachStep ?? app.confirmEachStep)}; step downs: ${onOff(e.stepDowns)}; ask BeyondATC: ${onOff(e.atcFirst)}; open window at airport: ${onOff(s?.openWindowAtAirport)}`)
  if (e.atcOtherAircraft || e.askOnly) {
    add('Other aircraft', `ask BeyondATC in other aircraft: ${onOff(e.atcOtherAircraft)}; the loaded aircraft is ${e.askOnly ? 'one the app only asks BeyondATC about (nothing is sent to it)' : 'controlled by the app, or not followed'}`)
  }
  if (state.atc?.enabled) {
    const r = state.atc.request
    add('BeyondATC', `${state.atc.connected ? 'connected' : 'not reachable'}; auto respond: ${state.atc.autoRespond == null ? 'unknown' : onOff(state.atc.autoRespond)}${r ? `; last request ${fl(r.altFt)}: ${r.status} (${r.note})` : ''}`)
  }
  out.push('')

  const p = state.plan
  add('Plan', p ? `${p.source}, ${p.origin || '?'} to ${p.destination || '?'}${p.generatedAt ? `, generated ${p.generatedAt}` : ''}; steps edited by hand: ${yesNo(p.edited)}` : 'no flight plan loaded')
  const steps = e.steps ?? []
  steps.forEach((st, i) => {
    out.push(`${''.padEnd(14)}${i + 1}. ${st.step.label} (${fl(st.step.fromAltFt)} to ${fl(st.step.toAltFt)}): ${st.status}${st.note ? ` (${st.note})` : ''}`)
  })
  if (state.planWarning) add('Plan warning', state.planWarning)
  if (state.planError) add('Plan error', state.planError)
  add('Doing', `${e.phase ?? 'unknown'}: ${e.message ?? ''}`)
  if (e.distToNextNm != null) add('Next step', `${num(e.distToNextNm, 1)} NM away${e.crossTrackNm != null ? `, ${num(e.crossTrackNm, 1)} NM off the route` : ''}`)
  out.push('')

  const keep = options.logLines ?? 100
  const log = (state.logs ?? []).slice(-keep)
  out.push(`LOG (the newest ${log.length} lines, UTC, oldest first)`)
  for (const l of log) out.push(logLine(l))
  if (log.length === 0) out.push('(nothing logged yet)')

  return redact(out.join('\n'), env, options.secrets ?? { simbriefUsername: state.settings?.simbriefUsername ?? '' })
}
