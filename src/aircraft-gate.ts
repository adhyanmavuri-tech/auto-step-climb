/**
 * Decides whether the app should start at all: it only starts if the aircraft loaded in the sim is one it
 * supports (today: the iniBuilds A330, which has a profile and the FCU controls the app uses). The engine
 * already never controls any other aircraft; this makes the app say so and close instead of sitting in the
 * background reading an aircraft it can do nothing with.
 *
 * It waits while no aircraft is loaded (the sim is closed or at its menu), so starting the app before
 * loading your flight still works. An aircraft that is not supported has to stay loaded for the grace
 * period before it counts, because the sim shows other titles for a moment while a flight loads. Once an
 * A330 has been seen the answer stays "ok" for the whole run: changing aircraft later is not this
 * check's business (the engine just stops acting for an unsupported one).
 */

export type GateVerdict = 'waiting' | 'ok' | 'unsupported'

export interface GateState {
  verdict: GateVerdict
  /** The loaded aircraft the verdict is about, once there is one. */
  title: string | null
  /** For "unsupported": why, in a sentence for the user. */
  reason: string | null
  /** For "unsupported": the same in a few words, for the tray's hover text. */
  short: string | null
}

export interface GateReading {
  /** The aircraft's title, empty when none is loaded. */
  title: string
  /** True when it matches a profile and has the controls that profile uses. */
  aircraftOk: boolean
  /** False when the sim reports no position yet (a menu, or a flight still loading). */
  hasPosition: boolean
  /** The profile its title matched, or null when none did. */
  matchedProfile: string | null
}

export interface GateOptions {
  /** How long an unsupported aircraft has to stay loaded before the app closes. */
  graceMs: number
  /** The names of the aircraft the app supports, for the message. */
  supported: string[]
}

export class AircraftGate {
  private readonly opts: GateOptions
  private state: GateState = { verdict: 'waiting', title: null, reason: null, short: null }
  private badSince: number | null = null
  private badTitle = ''

  constructor(opts: GateOptions) {
    this.opts = opts
  }

  /** Feed it each reading (null: no data from the sim) with the time it was taken. */
  update(t: number, reading: GateReading | null): GateState {
    if (this.state.verdict !== 'waiting') return this.state // decided for the whole run
    if (!reading || reading.title === '' || !reading.hasPosition) {
      this.badSince = null
      return this.state
    }
    if (reading.aircraftOk) {
      this.state = { verdict: 'ok', title: reading.title, reason: null, short: null }
      return this.state
    }
    if (this.badSince === null || this.badTitle !== reading.title) {
      this.badSince = t
      this.badTitle = reading.title
    }
    this.state = { ...this.state, title: reading.title }
    if (t - this.badSince >= this.opts.graceMs) {
      const names = this.opts.supported.join(', ') || 'the iniBuilds A330'
      this.state = reading.matchedProfile
        ? {
            verdict: 'unsupported',
            title: reading.title,
            reason: `The loaded aircraft ("${reading.title}") matches ${reading.matchedProfile}, but it doesn't have the controls the app uses (an aircraft update may have renamed them; the log says which).`,
            short: `${reading.title}: its controls are missing`
          }
        : {
            verdict: 'unsupported',
            title: reading.title,
            reason: `The loaded aircraft is "${reading.title}". This app only works with ${names}. Load it and start the app again.`,
            short: `${reading.title} is not supported`
          }
    }
    return this.state
  }
}
