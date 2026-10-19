// Builds data/airports.json from the OurAirports airport list (airports.csv, public domain).
//
//   npm run build-airports -- --src=PATH\to\airports.csv
//
// The CSV is not downloaded by this script: give it a copy you already have. The result is checked in, so
// this only needs running to refresh the list.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { airportFileText, airportsFromOurAirports } from '../src/airports-build.ts'

const root = path.resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { src: { type: 'string' }, out: { type: 'string' } } })

if (!values.src) {
  console.error('Usage: npm run build-airports -- --src=PATH\\to\\airports.csv [--out=data/airports.json]')
  process.exit(2)
}

const out = path.resolve(root, values.out ?? path.join('data', 'airports.json'))
const { airports, counts } = airportsFromOurAirports(fs.readFileSync(path.resolve(values.src), 'utf8'))
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, airportFileText(airports, new Date().toISOString().slice(0, 10)))
console.log(`Wrote ${airports.length} airports to ${out}`)
for (const [kind, n] of Object.entries(counts)) console.log(`  ${kind}: ${n}`)
console.log(`  size: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
