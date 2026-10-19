import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { AirportIndex, parseAirportFile } from '../src/airports.ts'
import { airportFileText, airportsFromOurAirports, parseCsv } from '../src/airports-build.ts'

const HEADER = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"'

const CSV = [
  HEADER,
  '1,"EGLL","large_airport","London Heathrow Airport",51.4706,-0.461941,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR","EGLL",,,,',
  '2,"KJFK","large_airport","John F Kennedy International Airport",40.639801,-73.7789,13,"NA","US","US-NY","New York","yes","KJFK","JFK","KJFK","JFK",,,',
  '3,"NZAA","large_airport","Auckland, ""Int"" Airport",-37.0082,174.792,23,"OC","NZ","NZ-AUK","Auckland","yes","NZAA","AKL","NZAA",,,,',
  '4,"EGKB","medium_airport","Biggin Hill Airport",51.3308,0.0325,598,"EU","GB","GB-ENG","London","no","EGKB","BQH","EGKB",,,,',
  '5,"EGHH","small_airport","Bournemouth",50.78,-1.8425,38,"EU","GB","GB-ENG","Bournemouth","yes","EGHH","BOH","EGHH",,,,',
  '6,"EGXX","small_airport","Grass strip",52,-1,100,"EU","GB","GB-ENG","Nowhere","no",,,"EGXX",,,,',
  '7,"00A","heliport","Total RF Heliport",40.07,-74.93,11,"NA","US","US-PA","Bensalem","no",,,"K00A","00A",,,',
  '8,"EGZZ","closed","Old field",52,-1,10,"EU","GB","GB-ENG","Gone","no",,,,,,,',
  '9,"EGSS","large_airport","London Stansted Airport",,,348,"EU","GB","GB-ENG","London","yes","EGSS","STN","EGSS",,,,'
].join('\r\n')

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes and both line endings', () => {
    assert.deepEqual(parseCsv('a,"b,c","d ""e"" f"\r\n1,2,3\n'), [
      ['a', 'b,c', 'd "e" f'],
      ['1', '2', '3']
    ])
  })
})

describe('building the airport list', () => {
  it('keeps real airports with four-letter codes and drops the rest', () => {
    const { airports, counts } = airportsFromOurAirports(CSV)
    assert.deepEqual(
      airports.map((a) => a[0]),
      ['EGHH', 'EGKB', 'EGLL', 'KJFK', 'NZAA'],
      'sorted; the heliport, closed field, unscheduled strip and the row with no position are gone'
    )
    assert.equal(counts.large_airport, 3)
    assert.equal(counts.medium_airport, 1)
    assert.equal(counts.small_airport, 1)
  })

  it('rounds positions and writes one airport to a line', () => {
    const { airports } = airportsFromOurAirports(CSV)
    const text = airportFileText(airports, '2026-10-17')
    const parsed = JSON.parse(text) as { generated: string; airports: unknown[][] }
    assert.equal(parsed.generated, '2026-10-17')
    assert.deepEqual(parsed.airports.find((a) => a[0] === 'EGLL'), ['EGLL', 'London Heathrow Airport', 51.4706, -0.4619, 83])
    assert.equal(text.split('\n').length, airports.length + 3, 'a head line, one per airport, and the closing line')
  })

  it('says what is wrong with a file that is not the airport list', () => {
    assert.throws(() => airportsFromOurAirports('a,b\n1,2'), /no "ident" column/)
    assert.throws(() => airportsFromOurAirports(''), /empty/)
  })
})

describe('AirportIndex', () => {
  const index = new AirportIndex([
    { icao: 'EGLL', name: 'London Heathrow Airport', lat: 51.4706, lon: -0.4619, elevFt: 83 },
    { icao: 'EGWU', name: 'RAF Northolt', lat: 51.553, lon: -0.4182, elevFt: 124 },
    { icao: 'NFFN', name: 'Nadi', lat: -17.7554, lon: 177.4434, elevFt: 59 },
    { icao: 'NFNA', name: 'Nausori', lat: -18.0433, lon: 178.5592, elevFt: 17 }
  ])

  it('finds the nearest airport inside the radius', () => {
    const near = index.nearest({ lat: 51.4715, lon: -0.46 }, 6)
    assert.equal(near?.airport.icao, 'EGLL')
    assert.ok(near && near.nm < 0.2)
  })

  it('picks the closer of two', () => {
    assert.equal(index.nearest({ lat: 51.54, lon: -0.42 }, 10)?.airport.icao, 'EGWU')
  })

  it('returns nothing when no airport is close enough', () => {
    assert.equal(index.nearest({ lat: 51.9, lon: 0.9 }, 6), null)
    assert.equal(index.nearest({ lat: 51.4706, lon: -0.4619 }, 0.01)?.airport.icao, 'EGLL')
  })

  it('works across the date line', () => {
    const fiji = new AirportIndex([{ icao: 'NFNL', name: 'Labasa', lat: -16.4667, lon: -179.9, elevFt: 40 }])
    assert.equal(fiji.nearest({ lat: -16.46, lon: 179.95 }, 20)?.airport.icao, 'NFNL')
  })

  it('looks a code up, whatever its case', () => {
    assert.equal(index.find(' egll ')?.name, 'London Heathrow Airport')
    assert.equal(index.find('ZZZZ'), null)
  })

  it('ignores a position that is not a number', () => {
    assert.equal(index.nearest({ lat: Number.NaN, lon: 0 }, 6), null)
  })
})

describe('airport file', () => {
  it('skips rows that are not airports and refuses a file with no list', () => {
    assert.equal(parseAirportFile({ airports: [['EGLL', 'Heathrow', 51.47, -0.46, 83], ['bad'], 'x', ['EGKK', 'Gatwick', 'north', 0, 0]] }).length, 1)
    assert.throws(() => parseAirportFile({}), /no "airports" list/)
  })

  it('loads from disk, and a missing or damaged file gives null instead of stopping the app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-airports-'))
    try {
      const good = path.join(dir, 'airports.json')
      fs.writeFileSync(good, '﻿' + airportFileText([['EGLL', 'Heathrow', 51.47, -0.46, 83]], '2026-10-17'))
      assert.equal(AirportIndex.tryLoad(good)?.size, 1, 'a byte order mark is fine')
      const bad = path.join(dir, 'bad.json')
      fs.writeFileSync(bad, '{ nope')
      assert.equal(AirportIndex.tryLoad(bad), null)
      assert.equal(AirportIndex.tryLoad(path.join(dir, 'missing.json')), null)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
