import { distanceNm } from './geo.ts'
import type { Snapshot } from './types.ts'

/**
 * Tells when the sim is paused from the readings themselves, so nothing new has to be asked of the sim: an aircraft in
 * the air that has not moved at all between two readings. A pause is kept until the aircraft is seen to move again.
 * It never says "paused" on the ground, where a parked aircraft really does stand still.
 *
 * If it is ever wrong it is wrong on the safe side: the engine then waits and does nothing, it never acts on a guess.
 */
export class PauseWatch {
  /** Two readings closer together than this prove nothing: the sim may simply not have drawn a new frame yet. */
  static readonly MIN_GAP_MS = 400
  /** Moving less than this (about a metre) between two readings counts as standing still. */
  static readonly STILL_NM = 0.0005

  private prev: { t: number; lat: number; lon: number } | null = null
  private paused = false

  /** Marks the reading `simPaused` while the sim is paused. No reading (null) makes it forget everything. */
  mark(snap: Snapshot | null): Snapshot | null {
    if (!snap) {
      this.prev = null
      this.paused = false
      return snap
    }
    const here = { t: snap.t, lat: snap.lat, lon: snap.lon }
    const prev = this.prev
    if (snap.onGround || !prev || snap.t < prev.t) {
      this.paused = false
      this.prev = here
      return snap
    }
    if (snap.t - prev.t >= PauseWatch.MIN_GAP_MS) {
      this.paused = distanceNm(prev, here) < PauseWatch.STILL_NM
      this.prev = here
    }
    return this.paused ? { ...snap, simPaused: true } : snap
  }
}
