import { distanceNm, projectOnSegment } from './geo.ts'
import type { LatLon } from './types.ts'

export interface RoutePosition {
  /** Distance along the planned route to the aircraft's projected position, NM. */
  alongNm: number
  /** Distance from the planned track, NM. */
  crossNm: number
  segment: number
}

/** If the best match in the search window is further than this, search the whole route. */
const LOST_NM = 15

/**
 * Places the aircraft on the planned route. Searches a window around the last known leg first so
 * progress stays monotonic when the route doubles back on itself, and falls back to the whole
 * route when the aircraft is far from that window.
 */
export class RouteTracker {
  private readonly fixes: LatLon[]
  private readonly cum: number[]
  private lastSegment = -1

  constructor(fixes: LatLon[]) {
    this.fixes = fixes
    this.cum = [0]
    for (let i = 1; i < fixes.length; i++) {
      this.cum.push(this.cum[i - 1]! + distanceNm(fixes[i - 1]!, fixes[i]!))
    }
  }

  get totalNm(): number {
    return this.cum[this.cum.length - 1] ?? 0
  }

  /** Distance along the route of fix `index`, NM. */
  fixAlongNm(index: number): number {
    return this.cum[index] ?? 0
  }

  locate(p: LatLon): RoutePosition | null {
    const lastLeg = this.fixes.length - 2
    if (lastLeg < 0) return null

    let best: RoutePosition | null = null
    if (this.lastSegment >= 0) {
      best = this.search(p, Math.max(0, this.lastSegment - 1), Math.min(lastLeg, this.lastSegment + 8))
    }
    if (!best || best.crossNm > LOST_NM) {
      const whole = this.search(p, 0, lastLeg)
      if (whole && (!best || whole.crossNm < best.crossNm - 5)) best = whole
    }
    if (best) this.lastSegment = best.segment
    return best
  }

  private search(p: LatLon, from: number, to: number): RoutePosition | null {
    let best: RoutePosition | null = null
    let bestDist = Infinity
    for (let i = from; i <= to; i++) {
      const a = this.fixes[i]!
      const b = this.fixes[i + 1]!
      const len = this.cum[i + 1]! - this.cum[i]!
      if (len < 0.01) continue
      const pr = projectOnSegment(p, a, b)
      const inside = pr.alongNm >= 0 && pr.alongNm <= len
      const dist = inside ? pr.crossNm : Math.min(distanceNm(p, a), distanceNm(p, b))
      if (dist < bestDist) {
        bestDist = dist
        best = {
          alongNm: this.cum[i]! + Math.min(len, Math.max(0, pr.alongNm)),
          crossNm: dist,
          segment: i
        }
      }
    }
    return best
  }
}
