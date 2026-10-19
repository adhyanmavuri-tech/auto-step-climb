// Asks BeyondATC for an altitude change and then cancels it from the same menu, to show what the menu
// looks like. It NEVER chooses a level, so no altitude is requested, but it does make two calls on the
// radio (the request, then the cancellation), so you have to say --yes.
//
//   npm run atc-probe -- --yes
//   npm run atc-probe -- --yes --out=logs/atc-probe.txt      (also saves what happened)
//
// Run it in cruise with a controller tuned. Whatever happens, once it has asked it cancels before it ends
// (Ctrl+C too), because BeyondATC's controller keeps asking "say again altitude" until it is cancelled.
import fs from 'node:fs'
import path from 'node:path'
import { probeAltitudeMenu } from '../src/atc-probe.ts'

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

if (!process.argv.includes('--yes')) {
  console.error(
    'This asks BeyondATC for an altitude change and then cancels it, so your pilot makes two calls on the radio.\n' +
      'It never chooses a level. Add --yes to go ahead.'
  )
  process.exit(2)
}

const port = Number(arg('port') ?? 41716)
const outArg = arg('out')
const outFile = outArg ? path.resolve(import.meta.dirname, '..', outArg) : null
if (outFile) fs.mkdirSync(path.dirname(outFile), { recursive: true })
const emit = (line: string): void => {
  console.log(line)
  if (outFile) fs.appendFileSync(outFile, `${line}\n`)
}

const stop = new AbortController()
process.on('SIGINT', () => stop.abort())

const result = await probeAltitudeMenu({
  url: `ws://127.0.0.1:${port}`,
  signal: stop.signal,
  log: (ms, text) => emit(`${(ms / 1000).toFixed(1).padStart(6)} s  ${text}`)
})

emit('')
emit('---- result ----')
emit(`connected:      ${result.connected}`)
emit(`on offer:       ${result.offered}`)
emit(`asked:          ${result.asked}`)
emit(`menu that came: ${result.menu ? result.menu.join(' | ') : '(none)'}`)
emit(`levels in it:   ${result.levels.length ? result.levels.join(', ') : '(none)'}`)
emit(`cancel sent:    ${result.cancelLabel ?? '(not needed: nothing was asked)'}`)
emit(`cancelled:      ${result.cancelled}`)
emit(`said:           ${result.said.length ? `\n  ${result.said.join('\n  ')}` : '(nothing heard)'}`)
emit(`note:           ${result.note}`)
process.exit(result.asked && !result.cancelled ? 1 : 0)
