// Read-only: connects to BeyondATC's toolbar connection and prints what it sends. It sends nothing
// (add --ping to send a single "ping", which only gets a "Pong" back), so it changes nothing in
// BeyondATC and never touches the simulator.
//
//   npm run atc-listen
//   npm run atc-listen -- --seconds=300 --out=logs/atc-capture.txt   (also saves what it hears)
import fs from 'node:fs'
import path from 'node:path'
import { parseMessage } from '../src/beyondatc.ts'
import { WebSocketClient } from '../src/ws-client.ts'

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const port = Number(arg('port') ?? 41716)
const seconds = Number(arg('seconds') ?? 20)
// Only questions BeyondATC's own toolbar asks on loading; none of them changes anything.
const READ_ONLY = new Set(['ping', 'settings', 'frequencies', 'atc_log', 'datis'])
const sendList = (arg('send') ?? (process.argv.includes('--ping') ? 'ping' : ''))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')
for (const c of sendList) {
  if (!READ_ONLY.has(c)) {
    console.error(`"${c}" is not one of the read-only queries (${[...READ_ONLY].join(', ')}); refusing to send it.`)
    process.exit(2)
  }
}
const url = `ws://127.0.0.1:${port}`

const outArg = arg('out')
const outFile = outArg ? path.resolve(import.meta.dirname, '..', outArg) : null
if (outFile) fs.mkdirSync(path.dirname(outFile), { recursive: true })
const emit = (line: string): void => {
  console.log(line)
  if (outFile) fs.appendFileSync(outFile, `${line}\n`)
}

const stamp = (): string => new Date().toLocaleTimeString()
const shorten = (text: string): string => (text.length > 600 ? `${text.slice(0, 600)}...` : text)

// Our own small client, not Node's WebSocket: BeyondATC compresses its messages when a client offers
// compression, and Node's built-in client then hands over empty strings.
const ws = new WebSocketClient(url)
let opened = false
ws.onopen = () => {
  opened = true
  emit(`${stamp()}  connected to ${url}; listening for ${seconds} s and sending ${sendList.length ? sendList.join(', ') : 'nothing'}`)
  sendList.forEach((c, i) => setTimeout(() => ws.send(c), 300 * (i + 1)))
}
ws.onmessage = (ev) => {
  const data = ev.data
  const text = typeof data === 'string' ? data : `[${typeof data} ${Object.prototype.toString.call(data)}]`
  const msg = typeof data === 'string' ? parseMessage(text) : null
  const shown = msg ? text.replace(/¬/g, ' | ') : JSON.stringify(text)
  emit(`${stamp()}  ${(msg?.kind ?? 'unparsed').padEnd(11)} ${shorten(shown)}`)
}
ws.onerror = (ev) => {
  if (!opened) emit(`Could not connect to ${url}. Is BeyondATC running? ${(ev as { message?: string }).message ?? ''}`.trim())
}
ws.onclose = () => {
  emit(`${stamp()}  connection closed`)
  process.exit(opened ? 0 : 1)
}
setTimeout(() => {
  emit(`${stamp()}  done`)
  ws.close()
}, seconds * 1000)
