import assert from 'node:assert/strict'
import net from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { probeAltitudeMenu } from '../src/atc-probe.ts'
import type { ProbeResult } from '../src/atc-probe.ts'
import { TestWsServer } from './ws-server.ts'
import type { ServerConnection } from './ws-server.ts'

const BASE = 'Actions: [Call Ready for Descent¬Request Approach Change¬Request Altitude Change¬Request Direct to Fix¬Radio Check¬]'
const NO_REQUEST = 'Actions: [Call Ready for Descent¬Radio Check¬]'

describe('altitude menu probe', () => {
  let server: TestWsServer
  let port: number
  beforeEach(async () => {
    server = new TestWsServer()
    port = await server.listen()
  })
  afterEach(() => server.close())

  /** A BeyondATC that lists `list` on connecting and answers the way the community describes it. */
  function behave(opts: { list?: string; menu?: string | null; cancelWording?: string } = {}): void {
    const list = opts.list ?? BASE
    const menu = opts.menu === undefined ? 'Actions: [Cancel Altitude Change¬FL340¬FL360¬FL380¬Say Again¬]' : opts.menu
    server.onConnection = (c: ServerConnection) => {
      c.sendText('Facility: Oakland Center|134.150')
      c.sendText(list)
      let seen = 0
      const timer = setInterval(() => {
        for (; seen < c.received.length; seen++) {
          const m = c.received[seen]!
          if (m === 'set_action: Request Altitude Change' && menu) c.sendText(menu)
          if (/^set_action: cancel/i.test(m)) {
            c.sendText(`ATC: Test 123 Heavy, roger, ${opts.cancelWording ?? 'altitude change request cancelled'}.`)
            c.sendText(list)
          }
        }
      }, 5)
      timer.unref()
    }
  }
  const probe = (extra: Partial<Parameters<typeof probeAltitudeMenu>[0]> = {}): Promise<ProbeResult> =>
    probeAltitudeMenu({ url: `ws://127.0.0.1:${port}`, listWaitMs: 400, menuWaitMs: 300, cancelWaitMs: 400, ...extra })

  it('asks, cancels from the menu that came, and sends nothing else: never a level', async () => {
    behave()
    const r = await probe()
    assert.equal(r.offered, true)
    assert.equal(r.asked, true)
    assert.deepEqual(r.menu, ['Cancel Altitude Change', 'FL340', 'FL360', 'FL380', 'Say Again'])
    assert.deepEqual(r.levels, ['FL340', 'FL360', 'FL380'])
    assert.equal(r.cancelLabel, 'Cancel Altitude Change')
    assert.equal(r.cancelled, true)
    assert.ok(r.said.some((s) => /request cancelled/.test(s)))
    assert.deepEqual(server.connections[0]!.received, ['set_action: Request Altitude Change', 'set_action: Cancel Altitude Change'])
  })

  it('cancels in the menu\'s own wording', async () => {
    behave({ menu: 'Actions: [CANCEL altitude change¬FL360¬FL380¬]' })
    const r = await probe()
    assert.equal(r.cancelLabel, 'CANCEL altitude change')
    assert.deepEqual(server.connections[0]!.received, ['set_action: Request Altitude Change', 'set_action: CANCEL altitude change'])
    assert.equal(r.cancelled, true)
  })

  it('cancels anyway when no menu appears, because the controller would otherwise keep asking', async () => {
    behave({ menu: null })
    const r = await probe()
    assert.equal(r.asked, true)
    assert.equal(r.menu, null)
    assert.equal(r.cancelLabel, 'Cancel Altitude Change')
    assert.deepEqual(server.connections[0]!.received, ['set_action: Request Altitude Change', 'set_action: Cancel Altitude Change'])
    assert.equal(r.cancelled, true) // the test server confirms the cancellation
  })

  it('sends nothing when the request is not on offer', async () => {
    behave({ list: NO_REQUEST })
    const r = await probe()
    assert.equal(r.offered, false)
    assert.equal(r.asked, false)
    assert.deepEqual(server.connections[0]!.received, [])
    assert.match(r.note, /not on offer/)
  })

  it('sends nothing when BeyondATC never lists what is on offer', async () => {
    server.onConnection = () => {}
    const r = await probe({ listWaitMs: 150 })
    assert.equal(r.asked, false)
    assert.match(r.note, /did not send its list/)
    assert.deepEqual(server.connections[0]!.received, [])
  })

  it('cancels first when it is stopped after asking', async () => {
    behave({ menu: null })
    const stop = new AbortController()
    const running = probe({ signal: stop.signal, menuWaitMs: 5_000 })
    for (let i = 0; i < 200 && !(server.connections[0]?.received.length ?? 0); i++) await new Promise((r) => setTimeout(r, 5))
    stop.abort()
    const r = await running
    assert.deepEqual(server.connections[0]!.received, ['set_action: Request Altitude Change', 'set_action: Cancel Altitude Change'])
    assert.equal(r.cancelled, true)
  })

  it('reports a BeyondATC that cannot be reached, having sent nothing', async () => {
    const free = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port
        s.close(() => resolve(p))
      })
    })
    const r = await probeAltitudeMenu({ url: `ws://127.0.0.1:${free}` })
    assert.equal(r.connected, false)
    assert.equal(r.asked, false)
    assert.match(r.note, /could not connect/)
  })
})
