import { labelToFeet, parseMessage } from './beyondatc.ts'
import type { SocketLike } from './beyondatc.ts'
import { WebSocketClient } from './ws-client.ts'

/**
 * A check of BeyondATC's altitude-request menu that never changes your altitude: it asks "Request Altitude
 * Change", reads the menu BeyondATC shows, and cancels with the "Cancel Altitude Change" item of that same
 * menu. It never chooses a level, so no altitude is requested. It does make two calls on the radio
 * (the request and the cancellation), so it is run by hand (scripts/atc-probe.ts), not by the app.
 *
 * Whatever happens, once it has asked it cancels before it ends, because BeyondATC's controller keeps asking
 * for the altitude until the request is cancelled.
 */

const REQUEST_LABEL = 'Request Altitude Change'
const CANCEL_LABEL = 'Cancel Altitude Change'
const REQUEST = /^request altitude change$/i
const CANCEL = /^cancel/i

export interface ProbeOptions {
  url: string
  /** How long to wait for the list of what is on offer after connecting. */
  listWaitMs?: number
  /** How long to wait for the menu after asking. */
  menuWaitMs?: number
  /** How long to wait for the cancellation to show. */
  cancelWaitMs?: number
  /** Abort: if it has asked, it cancels first. */
  signal?: AbortSignal
  createSocket?: (url: string) => SocketLike
  /** Called with every step and every message that is not empty, with the milliseconds since the start. */
  log?: (ms: number, text: string) => void
}

export interface ProbeResult {
  connected: boolean
  /** Whether "Request Altitude Change" was on offer when the list arrived. */
  offered: boolean
  asked: boolean
  /** The items of the menu that followed the request, or null when none appeared. */
  menu: string[] | null
  /** The items of that menu that are levels. */
  levels: string[]
  /** What was sent for the cancellation (the menu's own wording when it had one). */
  cancelLabel: string | null
  /** The menu went back to normal, or the controller said it was cancelled. */
  cancelled: boolean
  /** What the controller and the pilot said while the probe ran. */
  said: string[]
  note: string
}

export function probeAltitudeMenu(opts: ProbeOptions): Promise<ProbeResult> {
  const listWaitMs = opts.listWaitMs ?? 8_000
  const menuWaitMs = opts.menuWaitMs ?? 60_000
  const cancelWaitMs = opts.cancelWaitMs ?? 30_000

  return new Promise((resolve) => {
    const t0 = Date.now()
    const say = (text: string): void => opts.log?.(Date.now() - t0, text)
    const result: ProbeResult = { connected: false, offered: false, asked: false, menu: null, levels: [], cancelLabel: null, cancelled: false, said: [], note: '' }
    let stage: 'connecting' | 'listing' | 'asked' | 'cancelling' = 'connecting'
    let done = false
    let timer: NodeJS.Timeout | null = null
    let socket: SocketLike

    const arm = (ms: number, then: () => void): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(then, ms)
    }
    const send = (text: string): void => {
      say(`sending: ${text}`)
      try {
        socket.send(text)
      } catch (err) {
        say(`could not send: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const finish = (note: string): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      result.note = note
      say(`done: ${note}`)
      try {
        socket.close()
      } catch {
        // already closed
      }
      resolve(result)
    }
    /** Cancels what was asked, in the menu's own words when it gave any. */
    const cancel = (label: string, why: string): void => {
      if (stage === 'cancelling') return
      stage = 'cancelling'
      result.cancelLabel = label
      say(`cancelling (${why})`)
      send(`set_action: ${label}`)
      arm(cancelWaitMs, () => finish('the cancellation was sent, but BeyondATC did not show it done'))
    }
    const abort = (): void => {
      if (done) return
      if (stage === 'asked') cancel(CANCEL_LABEL, 'stopped before the menu came')
      else if (stage !== 'cancelling') finish('stopped before it asked anything')
    }

    try {
      socket = (opts.createSocket ?? ((url) => new WebSocketClient(url)))(opts.url)
    } catch (err) {
      result.note = `could not connect: ${err instanceof Error ? err.message : String(err)}`
      resolve(result)
      return
    }
    opts.signal?.addEventListener('abort', abort, { once: true })

    socket.onopen = () => {
      result.connected = true
      stage = 'listing'
      say('connected; waiting for BeyondATC to list what is on offer')
      arm(listWaitMs, () => finish('BeyondATC did not send its list of what is on offer'))
    }
    socket.onerror = (ev) => {
      if (!result.connected) say(`could not connect: ${(ev as { message?: string }).message ?? ''}`.trim())
    }
    socket.onclose = () => {
      if (done) return
      finish(result.connected ? 'the connection closed' : 'could not connect to BeyondATC (is it running?)')
    }
    socket.onmessage = (ev) => {
      const frame = typeof ev.data === 'string' ? ev.data : ''
      if (frame.trim() === '') return
      const msg = parseMessage(frame)
      if (!msg) return
      if (msg.kind !== 'other' || /^(CommsState|QueuedAction|Prompt|AppError|InfoBoxes)$/.test(msg.prefix)) say(`BeyondATC: ${frame.length > 300 ? `${frame.slice(0, 300)}...` : frame.replace(/¬/g, ' | ')}`)
      if (msg.kind === 'log') {
        if (msg.source === 'atc' || msg.source === 'cpdlcAtc' || msg.source === 'player' || msg.source === 'cpdlcPilot') result.said.push(`${msg.source}: ${msg.text}`)
        if (stage === 'cancelling' && /cancel/i.test(msg.text)) result.cancelled = true
        return
      }
      if (msg.kind !== 'actions') return

      if (stage === 'listing') {
        result.offered = msg.items.some((a) => REQUEST.test(a))
        if (!result.offered) return finish(`"${REQUEST_LABEL}" is not on offer right now, so nothing was sent`)
        result.asked = true
        stage = 'asked'
        send(`set_action: ${msg.items.find((a) => REQUEST.test(a)) ?? REQUEST_LABEL}`)
        arm(menuWaitMs, () => cancel(CANCEL_LABEL, 'no menu appeared'))
      } else if (stage === 'asked') {
        const item = msg.items.find((a) => CANCEL.test(a))
        if (!item && msg.items.some((a) => REQUEST.test(a))) return // the list as it was before: the menu has not come yet
        result.menu = msg.items
        result.levels = msg.items.filter((a) => labelToFeet(a) !== null)
        cancel(item ?? CANCEL_LABEL, item ? 'from the menu that appeared' : 'the menu has no cancel item')
      } else if (stage === 'cancelling') {
        if (!msg.items.some((a) => CANCEL.test(a))) {
          result.cancelled = true
          finish('cancelled: the menu is back to normal')
        }
      }
    }
  })
}
