// Read-only probe of the running sim: which aircraft is loaded, what the autopilot SimVars say, and
// which FCU input events that aircraft offers (with their current values). Sends nothing.
// Run it with the aircraft loaded:  npm run discover      (result is also saved to discovery.json)
// With --write-profile it also drafts a profile for the loaded aircraft into profiles/_draft-*.json:
//   npm run discover -- --write-profile
import fs from 'node:fs'
import path from 'node:path'
import { open, Protocol, SimConnectConstants, SimConnectDataType as T, SimConnectPeriod } from 'node-simconnect'
import type { OpenEvent } from 'node-simconnect'
import { draftKnobProfile } from '../src/draft-profile.ts'

const OUT = path.resolve(import.meta.dirname, '..', 'discovery.json')
const APP = 'A330 AutoStep discover'
const FCU_EVENTS = /MCU|FCU|AP1|AP2|ATHR|APPR|LOC_PUSH|ALT_PUSH/i
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const bigintSafe = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

const FIELDS: [string, string | null, T][] = [
  ['TITLE', null, T.STRING256],
  ['SIM ON GROUND', 'bool', T.INT32],
  ['INDICATED ALTITUDE', 'feet', T.FLOAT64],
  ['VERTICAL SPEED', 'feet per minute', T.FLOAT64],
  ['AIRSPEED MACH', 'mach', T.FLOAT64],
  ['TOTAL WEIGHT', 'pounds', T.FLOAT64],
  ['AUTOPILOT MASTER', 'bool', T.INT32],
  ['AUTOPILOT ALTITUDE LOCK VAR', 'feet', T.FLOAT64],
  ['AUTOPILOT ALTITUDE LOCK VAR:3', 'feet', T.FLOAT64],
  ['GPS IS ACTIVE FLIGHT PLAN', 'bool', T.INT32],
  ['GPS FLIGHT PLAN WP COUNT', 'number', T.INT32]
]

async function connect(): Promise<OpenEvent> {
  try {
    return await open(APP, Protocol.SunRise)
  } catch {
    return await open(APP, Protocol.KittyHawk)
  }
}

const watchdog = setTimeout(() => {
  console.log('Timed out waiting for the sim.')
  process.exit(2)
}, 30_000)

try {
  const { handle } = await connect()
  console.log('Connected.')

  const seen: { state: Record<string, string | number> | null } = { state: null }
  FIELDS.forEach(([name, unit, type]) => handle.addToDataDefinition(0, name, unit, type))
  handle.on('simObjectData', (d) => {
    if (d.requestID !== 0) return
    const row: Record<string, string | number> = {}
    for (const [name, , type] of FIELDS) {
      row[name] = type === T.STRING256 ? d.data.readString256() : type === T.INT32 ? d.data.readInt32() : d.data.readFloat64()
    }
    seen.state = row
  })
  handle.requestDataOnSimObject(0, 0, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE)

  const events = new Map<string, bigint>()
  let lastChunk = 0
  handle.on('inputEventsList', (recv) => {
    lastChunk = Date.now()
    for (const e of recv.inputEventDescriptors) events.set(e.name, e.inputEventIdHash)
  })
  handle.enumerateInputEvents(1)
  await sleep(2_500)
  while (lastChunk !== 0 && Date.now() - lastChunk < 1_200) await sleep(300)

  const wanted = [...events].filter(([name]) => FCU_EVENTS.test(name))
  const values: Record<string, number | string> = {}
  handle.on('getInputEvent', (r) => {
    const entry = wanted[r.requestID - 100]
    if (entry) values[entry[0]] = r.value
  })
  wanted.forEach(([, hash], i) => handle.getInputEvent(100 + i, hash))
  await sleep(1_500)

  console.log('\nAircraft / state')
  console.log(seen.state ?? '(no SimVar data - is a flight loaded?)')
  console.log(`\nInput events: ${events.size} in total, ${wanted.length} look FCU-related`)
  for (const [name, hash] of wanted) console.log(`  ${name}  hash=${hash}  value=${JSON.stringify(values[name])}`)

  fs.writeFileSync(
    OUT,
    JSON.stringify({ state: seen.state, fcuInputEvents: Object.fromEntries(wanted), values, allInputEvents: [...events.keys()].sort() }, bigintSafe, 2)
  )
  console.log(`\nSaved ${OUT}`)

  if (process.argv.includes('--write-profile')) {
    const aircraft = String(seen.state?.TITLE ?? '')
    if (!aircraft) {
      console.log('\nNo aircraft title was read, so no profile was drafted. Load a flight and try again.')
    } else {
      const { profile, notes } = draftKnobProfile(aircraft, [...events.keys()])
      console.log('\nProfile draft')
      for (const n of notes) console.log(`  - ${n}`)
      if (profile) {
        const slug = aircraft.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'aircraft'
        const file = path.resolve(import.meta.dirname, '..', 'profiles', `_draft-${slug}.json`)
        fs.writeFileSync(file, JSON.stringify(profile, null, 2) + '\n')
        console.log(`  Wrote ${file}\n  Check it, then rename it (drop the leading "_draft-") to activate it.`)
      }
    }
  }
  handle.close()
  clearTimeout(watchdog)
  process.exit(0)
} catch (err) {
  console.log('Could not connect to the sim:', err instanceof Error ? err.message : err)
  process.exit(1)
}
