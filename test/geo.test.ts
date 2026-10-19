import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bearingDeg, distanceNm, interpolate, projectOnSegment } from '../src/geo.ts'
import { RouteTracker } from '../src/route-tracker.ts'

const near = (actual: number, expected: number, tol: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: got ${actual}, expected ${expected} +/- ${tol}`)

describe('geo', () => {
  it('a degree of longitude on the equator is about 60 NM', () => {
    near(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 60.04, 0.05, 'distance')
  })

  it('London to New York is about 2,990 NM', () => {
    near(distanceNm({ lat: 51.47, lon: -0.4543 }, { lat: 40.6413, lon: -73.7781 }), 2990, 15, 'EGLL-KJFK')
  })

  it('bearing due east is 090 and due north is 000', () => {
    near(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }), 90, 0.01, 'east')
    near(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 }), 0, 0.01, 'north')
  })

  it('projects a point onto a segment', () => {
    const r = projectOnSegment({ lat: 1, lon: 5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 })
    near(r.crossNm, 60, 0.5, 'cross-track')
    near(r.alongNm, 300, 1, 'along-track')
  })

  it('along-track is negative behind the start of the segment', () => {
    const r = projectOnSegment({ lat: 0, lon: -2 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 })
    near(r.alongNm, -120, 1, 'along-track')
  })

  it('interpolates the midpoint of a segment', () => {
    const m = interpolate({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 0.5)
    near(m.lat, 0, 1e-9, 'lat')
    near(m.lon, 5, 1e-9, 'lon')
  })
})

describe('RouteTracker', () => {
  const route = [0, 5, 10, 15, 20].map((lon) => ({ lat: 0, lon }))

  it('reports progress along the route and distance off it', () => {
    const tracker = new RouteTracker(route)
    const pos = tracker.locate({ lat: 0.25, lon: 7.5 })!
    near(pos.alongNm, 450.3, 1, 'along')
    near(pos.crossNm, 15, 0.5, 'cross')
    near(tracker.fixAlongNm(2), 600.4, 0.5, 'fix 2')
  })

  it('finds its way back after being far off the route', () => {
    const tracker = new RouteTracker(route)
    tracker.locate({ lat: 0, lon: 2 })
    const lost = tracker.locate({ lat: 3, lon: 12 })!
    assert.ok(lost.crossNm > 150)
    const back = tracker.locate({ lat: 0, lon: 13 })!
    near(back.alongNm, 780.5, 1, 'along after rejoining')
  })

  it('has no position on a route with fewer than two fixes', () => {
    assert.equal(new RouteTracker([{ lat: 0, lon: 0 }]).locate({ lat: 0, lon: 0 }), null)
  })
})
