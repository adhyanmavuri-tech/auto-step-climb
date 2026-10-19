import type { AirportRow } from './airports.ts'

/**
 * Turns the OurAirports airport list (airports.csv, public domain: https://ourairports.com/data/) into the
 * short list the app ships. An A330 needs a real airport, so heliports, seaplane bases, closed airports and
 * small strips without scheduled flights are left out, and so is anything whose code is not a four-letter
 * ICAO code (SimBrief and the sim both use those).
 */

/** Splits CSV text into rows of fields. Handles quoted fields with commas, doubled quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface BuildResult {
  airports: AirportRow[]
  /** How many of each kept type, for the build log. */
  counts: Record<string, number>
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places

export function airportsFromOurAirports(csv: string): BuildResult {
  const rows = parseCsv(csv)
  const header = rows[0]
  if (!header) throw new Error('The airport file is empty')
  const col = (name: string): number => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`The airport file has no "${name}" column`)
    return i
  }
  const ident = col('ident')
  const type = col('type')
  const name = col('name')
  const lat = col('latitude_deg')
  const lon = col('longitude_deg')
  const elev = col('elevation_ft')
  const scheduled = col('scheduled_service')

  const airports: AirportRow[] = []
  const counts: Record<string, number> = {}
  for (const r of rows.slice(1)) {
    const code = r[ident] ?? ''
    if (!/^[A-Z]{4}$/.test(code)) continue
    const kind = r[type] ?? ''
    const keep = kind === 'large_airport' || kind === 'medium_airport' || (kind === 'small_airport' && r[scheduled] === 'yes')
    if (!keep) continue
    const la = Number.parseFloat(r[lat] ?? '')
    const lo = Number.parseFloat(r[lon] ?? '')
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
    const ft = Number.parseFloat(r[elev] ?? '')
    airports.push([code, (r[name] ?? '').trim().slice(0, 80), round(la, 4), round(lo, 4), Number.isFinite(ft) ? Math.round(ft) : 0])
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  airports.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return { airports, counts }
}

/** The file's text: one airport to a line, so a change shows up as a small diff. */
export function airportFileText(airports: AirportRow[], generated: string): string {
  const head = `{"source":"OurAirports (public domain, https://ourairports.com/data/)","generated":${JSON.stringify(generated)},"airports":[\n`
  return `${head}${airports.map((a) => JSON.stringify(a)).join(',\n')}\n]}\n`
}
