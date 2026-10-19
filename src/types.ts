export interface LatLon {
  lat: number
  lon: number
}

/** One fix of the planned route (from the SimBrief navlog). */
export interface RouteFix extends LatLon {
  ident: string
  /** Planned altitude at this fix, feet. */
  altitudeFt: number
  /** CLB, CRZ or DSC. */
  stage: string
  /** Planned gross weight at this fix, kg, when the OFP carries enough data. */
  plannedWeightKg: number | null
}

export type StepTrigger =
  | { kind: 'fix'; fixIdent: string; fixIndex: number; lat: number; lon: number }
  | { kind: 'distance'; afterNm: number }

export interface PlannedStep {
  id: string
  label: string
  fromAltFt: number
  toAltFt: number
  trigger: StepTrigger
  plannedWeightKg: number | null
}

export interface FlightPlan {
  source: 'simbrief' | 'manual' | 'demo'
  origin: string
  destination: string
  /** The flight's name as SimBrief has it (its ATC callsign, for example ALK607). Empty or missing when it has none. */
  flight?: string
  generatedAt: string | null
  initialAltFt: number
  route: RouteFix[]
  steps: PlannedStep[]
}

/** One reading of the aircraft, as delivered by the sim adapter. */
export interface Snapshot {
  /** Milliseconds; only differences matter (Date.now() in the app, scripted in tests). */
  t: number
  title: string
  /** False when the loaded aircraft isn't an A330 or its FCU input events are missing. */
  aircraftOk: boolean
  onGround: boolean
  lat: number
  lon: number
  altFt: number
  vsFpm: number
  mach: number
  gsKt: number
  weightKg: number
  /** FCU selected altitude (what the FCU window shows). */
  fcuSelectedFt: number
  /** Altitude the autopilot is actually flying to. */
  apTargetFt: number
  /**
   * How this aircraft's FCU altitude is set: click by click on a knob, or in one action. "none" is an aircraft the app
   * does not control (it climbs by itself, or you climb it): the app only asks the ATC program for its steps.
   */
  control: 'knob' | 'direct' | 'none'
  /** The ATC program (BeyondATC), when the app is set up to ask it first. */
  atc?: AtcState | null
}

/** The ATC program's answer to the engine's latest altitude request. */
export interface AtcRequestState {
  altFt: number
  /** asking = in progress; granted = ATC confirmed the new level; refused = ATC didn't clear it; unavailable = the request couldn't be made. */
  status: 'asking' | 'granted' | 'refused' | 'unavailable'
  /** Why, or what ATC said, for the log and the dashboard. */
  note: string
}

/** What the engine knows about the ATC program. */
export interface AtcState {
  connected: boolean
  request: AtcRequestState | null
}

/** What the engine asks the sim adapter to do. */
export type SimCommand =
  | { type: 'fcu-click'; dir: 1 | -1 }
  | { type: 'set-altitude'; ft: number }
  | { type: 'engage'; mode: 'managed' | 'open' }

/** What the engine asks the ATC program to do. */
export type AtcCommand = { type: 'atc-request'; altFt: number } | { type: 'atc-cancel' }

/** What the engine asks the host to tell the person: a notification, as well as the line in the log. */
export interface NoteCommand {
  type: 'notify'
  title: string
  text: string
}

export type Command = SimCommand | AtcCommand | NoteCommand

export interface LogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  text: string
}
