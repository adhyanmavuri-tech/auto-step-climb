// Passive listener. While it runs, operate the FCU in the cockpit (turn the ALT knob, push it, pull
// it, flip the 100/1000 ring) and it prints exactly what each control sends. Sends nothing to the sim.
// Usage: npm run listen -- <seconds>      (default 120 s; Ctrl+C to stop)
import { open, Protocol, SimConnectConstants, SimConnectDataType as T, SimConnectPeriod as P } from 'node-simconnect'
import type { OpenEvent } from 'node-simconnect'

const APP = 'A330 AutoStep listen'
const WATCH = /MCU|AP1|AP2|ATHR|APPR|LOC_PUSH|ALT_PUSH|HDVS|SPDMACH|AIRLINER_VS|METRIC/i
const CHANGED = 1 // SIMCONNECT_DATA_REQUEST_FLAG_CHANGED
const seconds = Number(process.argv[2] ?? 120)
const t0 = Date.now()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const log = (line: string): void => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`)

const AP_FIELDS: [string, string, T][] = [
  ['AUTOPILOT MASTER', 'bool', T.INT32],
  ['AUTOPILOT ALTITUDE LOCK', 'bool', T.INT32],
  ['AUTOPILOT ALTITUDE LOCK VAR', 'feet', T.FLOAT64],
  ['AUTOPILOT ALTITUDE LOCK VAR:3', 'feet', T.FLOAT64],
  ['AUTOPILOT VERTICAL HOLD', 'bool', T.INT32],
  ['AUTOPILOT VERTICAL HOLD VAR', 'feet per minute', T.FLOAT64],
  ['AUTOPILOT FLIGHT LEVEL CHANGE', 'bool', T.INT32],
  ['AUTOPILOT AIRSPEED HOLD', 'bool', T.INT32],
  ['AUTOPILOT MACH HOLD', 'bool', T.INT32],
  ['AUTOPILOT THROTTLE ARM', 'bool', T.INT32],
  ['AUTOPILOT HEADING LOCK', 'bool', T.INT32],
  ['AUTOPILOT NAV1 LOCK', 'bool', T.INT32]
]

async function connect(): Promise<OpenEvent> {
  try {
    return await open(APP, Protocol.SunRise)
  } catch {
    return await open(APP, Protocol.KittyHawk)
  }
}

try {
  const { handle } = await connect()
  log('connected (listen only)')

  AP_FIELDS.forEach(([name, unit, type]) => handle.addToDataDefinition(0, name, unit, type))
  let prev: number[] | null = null
  handle.on('simObjectData', (d) => {
    if (d.requestID !== 0) return
    const cur = AP_FIELDS.map(([, , type]) => (type === T.INT32 ? d.data.readInt32() : d.data.readFloat64()))
    if (!prev) {
      log('AP snapshot ' + AP_FIELDS.map(([n], i) => `${n.replace('AUTOPILOT ', '')}=${cur[i]}`).join('  '))
    } else {
      const before = prev
      const diffs = AP_FIELDS.map(([n], i) => (cur[i] !== before[i] ? `${n.replace('AUTOPILOT ', '')}: ${before[i]} -> ${cur[i]}` : null)).filter(Boolean)
      if (diffs.length) log('SIMVAR ' + diffs.join(' | '))
    }
    prev = cur
  })
  handle.requestDataOnSimObject(0, 0, SimConnectConstants.OBJECT_ID_USER, P.SIM_FRAME, CHANGED)

  const all = new Map<bigint, string>()
  let lastChunk = 0
  handle.on('inputEventsList', (recv) => {
    lastChunk = Date.now()
    for (const e of recv.inputEventDescriptors) all.set(e.inputEventIdHash, e.name)
  })
  handle.enumerateInputEvents(2)
  await sleep(2_500)
  while (lastChunk !== 0 && Date.now() - lastChunk < 1_200) await sleep(300)

  const watched = [...all].filter(([, name]) => WATCH.test(name))
  log(`subscribing to ${watched.length} input events: ${watched.map(([, n]) => n).join(', ')}`)
  const subscribedAt = Date.now()
  handle.on('subscribeInputEvent', (r) => {
    const name = all.get(r.inputEventIdHash) ?? String(r.inputEventIdHash)
    log(`${Date.now() - subscribedAt < 2_500 ? 'initial' : 'INPUT  '} ${name} = ${JSON.stringify(r.value)}`)
  })
  for (const [hash] of watched) handle.subscribeInputEvent(hash)

  log(`listening for ${seconds} s - operate the FCU now`)
  process.on('SIGINT', () => {
    handle.close()
    process.exit(0)
  })
  await sleep(seconds * 1_000)
  handle.close()
  process.exit(0)
} catch (err) {
  console.log('Could not connect to the sim:', err instanceof Error ? err.message : err)
  process.exit(1)
}
