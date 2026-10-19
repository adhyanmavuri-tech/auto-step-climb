import fs from 'node:fs'
import { stripBom } from './config-write.ts'
import { distanceNm } from './geo.ts'
import type { LatLon } from './types.ts'

/**
 * The airports the app knows by name, so it can say "your A330 is at London Heathrow (EGLL)" and notice
 * when the flight plan is for somewhere else. The list is data/airports.json, built from the public-domain
 * OurAirports data by scripts/build-airports.ts. It only names places: the app does not need a place to be
 * in the list to work, because a custom airport in the sim is not in it.
 */

export interface Airport {
  icao: string
  name: string
  lat: number
  lon: number
  elevFt: number
}

export interface NearAirport {
  airport: Airport
  nm: number
}

/** One airport as stored in data/airports.json. */
export type AirportRow = [icao: string, name: string, lat: number, lon: number, elevFt: number]

export interface AirportFile {
  source: string
  generated: string
  airports: AirportRow[]
}

const NM_PER_DEG = 60

/** One cell for each degree of latitude and longitude, numbered so a longitude past 180 wraps round. */
function cellKey(latCell: number, lonCell: number): number {
  const lon = (((lonCell + 180) % 360) + 360) % 360
  return (latCell + 90) * 360 + lon
}

const isRow = (r: unknown): r is AirportRow =>
  Array.isArray(r) &&
  typeof r[0] === 'string' &&
  typeof r[1] === 'string' &&
  Number.isFinite(r[2]) &&
  Number.isFinite(r[3]) &&
  Number.isFinite(r[4])

/** The airports in a parsed data/airports.json. A row that is not an airport is skipped, a file that is not a list is refused. */
export function parseAirportFile(raw: unknown): Airport[] {
  const rows = (raw as { airports?: unknown } | null)?.airports
  if (!Array.isArray(rows)) throw new Error('airports.json has no "airports" list')
  return rows.filter(isRow).map(([icao, name, lat, lon, elevFt]) => ({ icao, name, lat, lon, elevFt }))
}

export class AirportIndex {
  readonly size: number
  private readonly cells = new Map<number, Airport[]>()
  private readonly codes = new Map<string, Airport>()

  constructor(airports: Airport[]) {
    for (const a of airports) {
      this.codes.set(a.icao, a)
      const key = cellKey(Math.floor(a.lat), Math.floor(a.lon))
      const cell = this.cells.get(key)
      if (cell) cell.push(a)
      else this.cells.set(key, [a])
    }
    this.size = airports.length
  }

  static fromFile(file: string): AirportIndex {
    return new AirportIndex(parseAirportFile(JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))))
  }

  /** The list in that file, or null when it is missing or damaged (the app then names no airports). */
  static tryLoad(file: string): AirportIndex | null {
    try {
      return AirportIndex.fromFile(file)
    } catch {
      return null
    }
  }

  find(icao: string): Airport | null {
    return this.codes.get(icao.trim().toUpperCase()) ?? null
  }

  /** The closest airport within `maxNm` of the point, or null. */
  nearest(p: LatLon, maxNm: number): NearAirport | null {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
    const latCells = Math.ceil(maxNm / NM_PER_DEG)
    // A degree of longitude is shorter away from the equator, so more of them fit in the same distance.
    const cosLat = Math.max(0.05, Math.cos((p.lat * Math.PI) / 180))
    const lonCells = Math.min(180, Math.ceil(maxNm / (NM_PER_DEG * cosLat)))
    const lat0 = Math.floor(p.lat)
    const lon0 = Math.floor(p.lon)
    let best: NearAirport | null = null
    for (let dy = -latCells; dy <= latCells; dy++) {
      const latCell = lat0 + dy
      if (latCell < -90 || latCell > 90) continue
      for (let dx = -lonCells; dx <= lonCells; dx++) {
        const cell = this.cells.get(cellKey(latCell, lon0 + dx))
        if (!cell) continue
        for (const airport of cell) {
          const nm = distanceNm(p, airport)
          if (nm <= maxNm && (best === null || nm < best.nm)) best = { airport, nm }
        }
      }
    }
    return best
  }
}
