import type { AirportIndex } from './airports.ts'
import type { Snapshot } from './types.ts'

/**
 * Decides when the Windows app "launches": opens its window and fetches the day's flight plan. That is when
 * the sim is running, the A330 is loaded, and it is on the ground at an airport, not moving fast.
 *
 * Nothing here starts a program (Windows cannot start one when something happens inside the sim, so the app
 * waits in the tray from the moment it is started). This only says when that waiting is over. The step
 * climbs themselves do not depend on it: the engine looks after the aircraft whenever it is flying.
 *
 * It fires once per arrival. It arms again when the sim goes away, the aircraft changes, or the aircraft has
 * been in the air for a while, so the next airport (or the next flight) counts again.
 */

export type LaunchPhase =
  /** The sim is not running, or not answering yet. */
  | 'no-sim'
  /** The sim is up but no flight is loaded (a menu or a loading screen). */
  | 'no-aircraft'
  /** An aircraft the app does not support is loaded. */
  | 'other-aircraft'
  /** The A330 is loaded but is flying, or moving fast on the ground. */
  | 'away'
  /** The A330 is parked or taxiing at an airport; the launch follows once that has held for a few seconds. */
  | 'at-airport'
  /** The launch has happened for this stay at the airport. */
  | 'launched'

export interface LaunchPlace {
  /** The airport's code when the airport list knows the place, otherwise null. */
  icao: string | null
  name: string | null
  /** How far the aircraft is from that airport's reference point. */
  nm: number | null
}

export interface LaunchState {
  phase: LaunchPhase
  /** Where the aircraft is, once it is on the ground. */
  place: LaunchPlace | null
}

export interface LaunchResult {
  state: LaunchState
  /** True on the one reading where the launch happens. */
  fire: boolean
}

export interface LaunchTriggerOptions {
  /** How long the aircraft has to stay on the ground at the airport before the launch. */
  holdMs: number
  /** Faster than this on the ground (a take-off roll) is not "at the airport". */
  maxGroundSpeedKt: number
  /** How close to an airport counts as being at it, when the airport list knows the place. */
  airportNm: number
  /** In the air for this long, the next arrival counts as a new one. */
  rearmAirborneMs: number
  /** The airports the app knows by name. Without it every place on the ground counts, but none is named. */
  airports?: AirportIndex | null
}

export const DEFAULT_LAUNCH_OPTIONS: LaunchTriggerOptions = {
  holdMs: 8_000,
  maxGroundSpeedKt: 60,
  airportNm: 6,
  rearmAirborneMs: 30_000
}

export class LaunchTrigger {
  private readonly opts: LaunchTriggerOptions
  private armed = true
  private title = ''
  private holdSince: number | null = null
  private airborneSince: number | null = null

  constructor(opts: Partial<LaunchTriggerOptions> = {}) {
    this.opts = { ...DEFAULT_LAUNCH_OPTIONS, ...opts }
  }

  /** Feed it every reading (null: none) with whether the sim connection is up, and the time of the reading. */
  update(t: number, connected: boolean, snap: Snapshot | null): LaunchResult {
    if (!connected) {
      this.reset()
      return this.result('no-sim', null)
    }
    // A menu or a loading screen reports an empty title or no position.
    if (!snap || snap.title === '' || (snap.lat === 0 && snap.lon === 0)) {
      this.title = ''
      this.holdSince = null
      this.airborneSince = null
      return this.result('no-aircraft', null)
    }
    if (snap.title !== this.title) {
      this.title = snap.title
      this.armed = true
      this.holdSince = null
      this.airborneSince = null
    }
    if (!snap.aircraftOk) return this.result('other-aircraft', null)

    if (snap.onGround) {
      this.airborneSince = null
    } else {
      this.airborneSince ??= t
      if (t - this.airborneSince >= this.opts.rearmAirborneMs) this.armed = true
    }

    const parked = snap.onGround && snap.gsKt <= this.opts.maxGroundSpeedKt
    if (!parked) {
      this.holdSince = null
      return this.result('away', null)
    }

    const place = this.placeOf(snap)
    if (!this.armed) return this.result('launched', place)
    this.holdSince ??= t
    if (t - this.holdSince < this.opts.holdMs) return this.result('at-airport', place)
    this.armed = false
    this.holdSince = null
    return this.result('launched', place, true)
  }

  private reset(): void {
    this.armed = true
    this.title = ''
    this.holdSince = null
    this.airborneSince = null
  }

  private placeOf(snap: Snapshot): LaunchPlace {
    const near = this.opts.airports?.nearest(snap, this.opts.airportNm) ?? null
    return near ? { icao: near.airport.icao, name: near.airport.name, nm: near.nm } : { icao: null, name: null, nm: null }
  }

  private result(phase: LaunchPhase, place: LaunchPlace | null, fire = false): LaunchResult {
    return { state: { phase, place }, fire }
  }
}
