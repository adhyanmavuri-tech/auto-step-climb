import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { BeyondAtcLink } from '../src/beyondatc.ts'
import { TestWsServer } from './ws-server.ts'
import type { ServerConnection } from './ws-server.ts'

/**
 * The link over a real TCP connection to a server that talks like BeyondATC's toolbar. The first
 * messages, in this order and format, are what a real BeyondATC sent on connecting during a flight
 * (2026-10-17, read with a plain WebSocket: a client that offers compression gets blanks instead).
 * How it answers a request was then seen on the wire too (npm run atc-probe, live, the same day): the
 * request is spoken, the controller says "I didn't get that altitude. Say again altitude.", and about ten
 * seconds after the request the menu "Cancel Altitude Change | FL340 | ... | Say Again" arrives.
 */
const BASE = 'Actions: [Call Ready for Descent¬Request Approach Change¬Request Runway Change¬Request Altitude Change¬Request Direct to Fix¬Submit Turbulence Pirep¬Submit Icing Pirep¬Radio Check¬]'
const SETTINGS = `Settings: ${JSON.stringify({ voiceVolume: 100, uiSounds: true, controllerVoice: 'Local', trafficVoice: 'Local', trafficOn: true, notes: 'x'.repeat(900) })}`

function snapshot(c: ServerConnection): void {
  c.sendText('Facility: Oakland Center|134.150')
  c.sendText('CPDLCCode: KZAK')
  c.sendText('AutoTune: true')
  c.sendText('AutoRespond: true')
  c.sendText(BASE)
  c.sendText('DATIS: KSFO|Z|KSFO ATIS Z 1539Z WIND CALM 10SM CLR 19/13')
  c.sendText('DATIS_END:')
  c.sendText('QueuedAction: ')
  c.sendText('InfoBoxes: [{"title":"Descend To","info":"FL360"}]')
  c.sendText('Com2: {"label":"Seattle Center","frequency":"124.850","monitor":true}')
  c.sendText('RadioMute: {"com1":false,"com2":false}')
  c.sendText('Progress: {"from":"KSFO","to":"NFFN","pct":12.5}')
  c.sendText('CommsState: {"mode":"ready","text":""}')
  c.sendText('LoadState: {"stage":"ready","text":"","pct":-1,"vfr":false,"loggedIn":true}')
  c.sendText('Callsign: {"full":"Test 123 Heavy","shortForm":""}')
  c.sendText('ToolbarVersion: 3.1')
  c.sendText(SETTINGS, [700]) // BeyondATC sent its settings in two fragments
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('BeyondATC link over a real connection', () => {
  let server: TestWsServer
  let log: string[]
  let link: BeyondAtcLink

  beforeEach(async () => {
    server = new TestWsServer()
    const port = await server.listen()
    log = []
    // no createSocket given: the link's own WebSocket client is what is being tested
    link = new BeyondAtcLink({ url: `ws://127.0.0.1:${port}`, log: (level, text) => log.push(`${level} ${text}`), menuWaitMs: 300, levelsWaitMs: 300, grantWaitMs: 300, reconnectMs: 50 })
  })
  afterEach(async () => {
    link.enable(false)
    await server.close()
  })

  async function connect(onConnection: (c: ServerConnection) => void): Promise<ServerConnection> {
    server.onConnection = (c) => {
      snapshot(c)
      onConnection(c)
    }
    link.enable(true)
    await waitFor(() => link.state.connected && link.autoRespond === true)
    return server.connections[0]!
  }

  it('reads what BeyondATC sends on connecting, as plain text', async () => {
    await connect(() => {})
    assert.equal(link.autoRespond, true, 'AutoRespond: true was read, not lost')
    assert.equal(log.some((l) => /Connected to BeyondATC/.test(l)), true)
  })

  it('asks for a level over the wire and reports the clearance', async () => {
    const conn = await connect((c) => {
      c.sendText('') // a blank frame is nothing
    })
    // The conversation as BeyondATC runs it: the request, the menu of levels, the level, the controller's answer.
    const wire = conn
    const handler = setInterval(() => {
      for (const m of wire.received) {
        if (handled.has(m)) continue
        handled.add(m)
        if (m === 'set_action: Request Altitude Change') wire.sendText('Actions: [Cancel Altitude Change¬FL340¬FL360¬FL380¬FL400¬Say Again¬]')
        if (m === 'set_action: FL380') {
          wire.sendText('ATC: Test 123 Heavy, roger, new cruise altitude FL380')
          wire.sendText(BASE)
        }
      }
    }, 5)
    const handled = new Set<string>()
    try {
      link.request(38000)
      assert.equal(link.state.request?.status, 'asking')
      await waitFor(() => link.state.request?.status === 'granted')
    } finally {
      clearInterval(handler)
    }
    assert.deepEqual(conn.received, ['set_action: Request Altitude Change', 'set_action: FL380'], 'it never needed to cancel')
    assert.equal(conn.allMasked, true)
    assert.ok(log.some((l) => l.includes('BeyondATC sent: Actions: [Cancel Altitude Change')), 'the menu BeyondATC sent is in the log, for when a request fails')
  })

  it('works through the conversation as BeyondATC really ran it (live, 2026-10-17): the first "say again altitude", the menu ten seconds later', async () => {
    const conn = await connect(() => {})
    const handled = new Set<string>()
    const timers: NodeJS.Timeout[] = []
    const later = (ms: number, fn: () => void): void => void timers.push(setTimeout(fn, ms))
    const handler = setInterval(() => {
      for (const m of conn.received) {
        if (handled.has(m)) continue
        handled.add(m)
        if (m === 'set_action: Request Altitude Change') {
          conn.sendText('QueuedAction: Request Altitude Change')
          conn.sendText('CommsState: {"mode":"queued","text":"Request Altitude Change"}')
          conn.sendText('QueuedAction: ')
          conn.sendText('Player: Test 123 Heavy, request altitude change.')
          later(20, () => conn.sendText(BASE)) // the list again, unchanged: not the menu
          later(40, () => conn.sendText("ATC: Test 123 Heavy, I didn't get that altitude. Say again altitude.")) // said even when all is well
          later(120, () => conn.sendText('Actions: [Cancel Altitude Change¬FL340¬FL360¬FL380¬FL400¬Say Again¬]'))
        }
        if (m === 'set_action: FL380') {
          conn.sendText('Player: Request FL380, Test 123 Heavy.')
          later(30, () => conn.sendText('ATC: Test 123 Heavy, roger, new cruise altitude FL380.'))
          later(60, () => conn.sendText(BASE))
        }
      }
    }, 5)
    try {
      link.request(38000)
      await waitFor(() => link.state.request?.status === 'granted')
    } finally {
      clearInterval(handler)
      timers.forEach(clearTimeout)
    }
    assert.deepEqual(conn.received, ['set_action: Request Altitude Change', 'set_action: FL380'], 'it asked, chose the level from the menu, and had nothing to cancel')
    assert.match(link.state.request!.note, /new cruise altitude FL380/)
  })

  it('cancels the request when BeyondATC never shows its level menu, because the controller would keep asking for the altitude', async () => {
    const conn = await connect(() => {})
    link.request(38000)
    await waitFor(() => link.state.request?.status === 'unavailable')
    assert.match(link.state.request!.note, /level menu did not appear/)
    await waitFor(() => conn.received.includes('set_action: Cancel Altitude Change'))
    assert.deepEqual(conn.received, ['set_action: Request Altitude Change', 'set_action: Cancel Altitude Change'])
  })

  it('cancels the request when the controller never answers the level', async () => {
    const conn = await connect(() => {})
    const handled = new Set<string>()
    const handler = setInterval(() => {
      for (const m of conn.received) {
        if (handled.has(m)) continue
        handled.add(m)
        if (m === 'set_action: Request Altitude Change') conn.sendText('Actions: [Cancel Altitude Change¬FL360¬FL380¬Say Again¬]')
      }
    }, 5)
    try {
      link.request(38000)
      await waitFor(() => link.state.request?.status === 'refused')
    } finally {
      clearInterval(handler)
    }
    assert.match(link.state.request!.note, /no answer/)
    await waitFor(() => conn.received.includes('set_action: Cancel Altitude Change'))
    assert.deepEqual(conn.received, ['set_action: Request Altitude Change', 'set_action: FL380', 'set_action: Cancel Altitude Change'])
  })

  it('does not connect to a server that compresses: it would hand over blanks, so it refuses and keeps trying', async () => {
    server.extensions = 'permessage-deflate; client_no_context_takeover; server_no_context_takeover'
    link.enable(true)
    await waitFor(() => log.some((l) => /not reachable/.test(l)))
    assert.equal(link.state.connected, false)
  })
})
