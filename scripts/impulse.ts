// Sends ONE value to ONE input event and watches what happens to it, to learn whether the aircraft
// consumes it like a cockpit click (the value drops back to 0 by itself) or leaves it set.
// This SENDS input to the sim, so it only runs with --yes.
//
//   npm run impulse -- AIRLINER_MCU_ALT_PUSH 1 --yes
//
// If the value is still set after 2.5 s it is put back to 0, so no push or pull stays latched.
import { open, Protocol } from 'node-simconnect'
import type { OpenEvent } from 'node-simconnect'

const [name, valueArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const confirmed = process.argv.includes('--yes')
const value = Number(valueArg)
const APP = 'Auto Step Climb impulse'
const POLL_AT_MS = [50, 150, 300, 600, 1200, 2500]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

if (!name || !Number.isFinite(value) || !confirmed) {
  console.log('Usage: npm run impulse -- <INPUT_EVENT_NAME> <value> --yes')
  console.log('This SENDS the value to the sim. Do it on the ground or in a safe state.')
  process.exit(1)
}

async function connect(): Promise<OpenEvent> {
  try {
    return await open(APP, Protocol.SunRise)
  } catch {
    return await open(APP, Protocol.KittyHawk)
  }
}

try {
  const { handle } = await connect()
  const events = new Map<string, bigint>()
  let lastChunk = 0
  handle.on('inputEventsList', (recv) => {
    lastChunk = Date.now()
    for (const e of recv.inputEventDescriptors) events.set(e.name, e.inputEventIdHash)
  })
  const readings = new Map<number, number | string>()
  handle.on('getInputEvent', (r) => readings.set(r.requestID, r.value))
  handle.enumerateInputEvents(1)
  await sleep(2_500)
  while (lastChunk !== 0 && Date.now() - lastChunk < 1_200) await sleep(300)

  const hash = events.get(name)
  if (hash === undefined) {
    console.log(`The loaded aircraft has no input event called ${name}.`)
    handle.close()
    process.exit(2)
  }

  const read = async (id: number): Promise<number | string | undefined> => {
    handle.getInputEvent(id, hash)
    for (let i = 0; i < 20 && !readings.has(id); i++) await sleep(10)
    return readings.get(id)
  }

  console.log(`before: ${await read(100)}`)
  const sentAt = Date.now()
  handle.setInputEvent(hash, value)
  console.log(`sent ${name} = ${value}`)

  let last: number | string | undefined
  let consumedAfter: number | null = null
  for (const [i, at] of POLL_AT_MS.entries()) {
    const wait = sentAt + at - Date.now()
    if (wait > 0) await sleep(wait)
    last = await read(200 + i)
    console.log(`+${Date.now() - sentAt} ms: ${last}`)
    if (consumedAfter === null && Number(last) === 0 && value !== 0) consumedAfter = Date.now() - sentAt
  }

  if (consumedAfter !== null) {
    console.log(`\nConsumed: the value was back to 0 within ${consumedAfter} ms, the way a cockpit click behaves.`)
  } else {
    console.log(`\nNot consumed: the value is still ${last} after 2.5 s. Putting it back to 0.`)
    handle.setInputEvent(hash, 0)
    await sleep(300)
    console.log(`now: ${await read(300)}`)
  }
  handle.close()
  process.exit(0)
} catch (err) {
  console.log('Could not connect to the sim:', err instanceof Error ? err.message : err)
  process.exit(1)
}
