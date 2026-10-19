import type { LatLon } from './types.ts'

const R_NM = 3440.065
const rad = (d: number): number => (d * Math.PI) / 180
const deg = (r: number): number => (r * 180) / Math.PI

/** Great-circle distance in nautical miles. */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial great-circle bearing a -> b, degrees 0-360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = rad(a.lat)
  const phi2 = rad(b.lat)
  const dLam = rad(b.lon - a.lon)
  const y = Math.sin(dLam) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export interface SegmentProjection {
  /** Signed distance from `a` along a -> b, NM (negative = behind a). */
  alongNm: number
  /** Perpendicular distance from the great circle a -> b, NM. */
  crossNm: number
}

/** Project point `p` onto the great circle through a -> b. */
export function projectOnSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection {
  const d13 = distanceNm(a, p) / R_NM
  if (d13 === 0) return { alongNm: 0, crossNm: 0 }
  const th13 = rad(bearingDeg(a, p))
  const th12 = rad(bearingDeg(a, b))
  const cross = Math.asin(Math.sin(d13) * Math.sin(th13 - th12))
  let along = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(cross))))
  if (Math.cos(th13 - th12) < 0) along = -along
  return { alongNm: along * R_NM, crossNm: Math.abs(cross) * R_NM }
}

/** Point a fraction `f` (0-1) of the way along the great circle a -> b. */
export function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const d = distanceNm(a, b) / R_NM
  if (d < 1e-12) return { lat: a.lat, lon: a.lon }
  const lat1 = rad(a.lat)
  const lon1 = rad(a.lon)
  const lat2 = rad(b.lat)
  const lon2 = rad(b.lon)
  const ka = Math.sin((1 - f) * d) / Math.sin(d)
  const kb = Math.sin(f * d) / Math.sin(d)
  const x = ka * Math.cos(lat1) * Math.cos(lon1) + kb * Math.cos(lat2) * Math.cos(lon2)
  const y = ka * Math.cos(lat1) * Math.sin(lon1) + kb * Math.cos(lat2) * Math.sin(lon2)
  const z = ka * Math.sin(lat1) + kb * Math.sin(lat2)
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) }
}
