import assert from 'node:assert/strict'
import net from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { WebSocketClient } from '../src/ws-client.ts'
import { TestWsServer } from './ws-server.ts'

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** A client with everything that happens to it written down. */
function open(port: number, opts?: { connectTimeoutMs?: number }) {
  const ws = new WebSocketClient(`ws://127.0.0.1:${port}`, opts)
  const seen = { opened: 0, closed: 0, messages: [] as string[], errors: [] as string[] }
  ws.onopen = () => seen.opened++
  ws.onclose = () => seen.closed++
  ws.onmessage = (ev) => seen.messages.push(String(ev.data))
  ws.onerror = (ev) => seen.errors.push((ev as { message: string }).message)
  return { ws, seen }
}

describe('WebSocket client', () => {
  let server: TestWsServer
  let port: number
  beforeEach(async () => {
    server = new TestWsServer()
    port = await server.listen()
  })
  afterEach(() => server.close())

  it('connects offering no extension, so a server that compresses when it may has nothing to compress', async () => {
    const { ws, seen } = open(port)
    await waitFor(() => seen.opened === 1)
    const req = server.connections[0]!.request
    assert.equal(req.line, 'GET / HTTP/1.1')
    assert.equal(req.headers.upgrade, 'websocket')
    assert.match(req.headers.connection ?? '', /upgrade/i)
    assert.equal(req.headers['sec-websocket-version'], '13')
    assert.ok((req.headers['sec-websocket-key'] ?? '').length >= 20)
    assert.equal(req.headers.host, `127.0.0.1:${port}`)
    assert.equal('sec-websocket-extensions' in req.headers, false, 'nothing is offered')
    ws.close()
  })

  it('receives text messages in order, and puts fragments back together, even inside a two-byte character', async () => {
    server.onConnection = (c) => {
      c.sendText('Facility: Oakland Center|134.150')
      c.sendText('Actions: [Cancel Altitude Change¬FL340¬FL360¬Say Again¬]', [9, 30, 7]) // the ¬ is two bytes; one cut lands inside it
      c.sendText('ToolbarVersion: 3.1')
    }
    const { ws, seen } = open(port)
    await waitFor(() => seen.messages.length === 3)
    assert.deepEqual(seen.messages, ['Facility: Oakland Center|134.150', 'Actions: [Cancel Altitude Change¬FL340¬FL360¬Say Again¬]', 'ToolbarVersion: 3.1'])
    ws.close()
  })

  it('receives long messages (the 16-bit and 64-bit length forms)', async () => {
    const medium = `Settings: ${'x'.repeat(300)}`
    const big = `Settings: ${'y'.repeat(70_000)}`
    server.onConnection = (c) => {
      c.sendText(medium)
      c.sendText(big)
    }
    const { ws, seen } = open(port)
    await waitFor(() => seen.messages.length === 2)
    assert.deepEqual(seen.messages, [medium, big])
    ws.close()
  })

  it('sends masked text frames, long and non-ASCII ones too', async () => {
    const { ws, seen } = open(port)
    await waitFor(() => seen.opened === 1)
    const conn = server.connections[0]!
    const long = 'z'.repeat(300)
    const huge = 'q'.repeat(70_000)
    ws.send('set_action: Request Altitude Change')
    ws.send(long)
    ws.send(huge)
    ws.send('set_action: Cancel Altitude Change ¬ é ✓')
    await waitFor(() => conn.received.length === 4)
    assert.deepEqual(conn.received, ['set_action: Request Altitude Change', long, huge, 'set_action: Cancel Altitude Change ¬ é ✓'])
    assert.equal(conn.allMasked, true)
    ws.close()
  })

  it('answers a ping with the same bytes', async () => {
    const { ws, seen } = open(port)
    await waitFor(() => seen.opened === 1)
    server.connections[0]!.sendPing(Buffer.from('hello'))
    await waitFor(() => server.connections[0]!.pongs.length === 1)
    assert.equal(server.connections[0]!.pongs[0]!.toString(), 'hello')
    ws.close()
  })

  it('reports it once when the server closes, and then refuses to send', async () => {
    const { ws, seen } = open(port)
    await waitFor(() => seen.opened === 1)
    server.connections[0]!.sendClose(1000)
    await waitFor(() => seen.closed === 1)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(seen.closed, 1)
    assert.throws(() => ws.send('late'), /not open/)
  })

  it('sends a close frame when closed, and reports it once', async () => {
    const { ws, seen } = open(port)
    await waitFor(() => seen.opened === 1)
    ws.close()
    ws.close()
    await waitFor(() => server.connections[0]!.closeCode !== null)
    assert.equal(server.connections[0]!.closeCode, 1000)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(seen.closed, 1)
  })

  it('reports it when the server just hangs up', async () => {
    const { seen } = open(port)
    await waitFor(() => seen.opened === 1)
    server.connections[0]!.end()
    await waitFor(() => seen.closed === 1)
  })

  it('refuses a handshake answered wrongly', async () => {
    server.badAccept = true
    const { seen } = open(port)
    await waitFor(() => seen.closed === 1)
    assert.equal(seen.opened, 0)
    assert.match(seen.errors[0] ?? '', /answered the handshake wrongly/)
  })

  it('refuses a server that picks an extension it was not offered, which is what a compressing server does', async () => {
    server.extensions = 'permessage-deflate; client_no_context_takeover; server_no_context_takeover'
    const { seen } = open(port)
    await waitFor(() => seen.closed === 1)
    assert.equal(seen.opened, 0)
    assert.match(seen.errors[0] ?? '', /extension/)
  })

  it('refuses a compressed frame instead of passing on blanks', async () => {
    const { seen } = open(port)
    await waitFor(() => seen.opened === 1)
    server.connections[0]!.sendFrame({ rsv: 4, opcode: 1, payload: Buffer.from([0x4a, 0x4c, 0x4a]) })
    await waitFor(() => seen.closed === 1)
    assert.match(seen.errors[0] ?? '', /extension/)
    assert.deepEqual(seen.messages, [])
  })

  it('refuses a message that is too big', async () => {
    const { seen } = open(port)
    await waitFor(() => seen.opened === 1)
    server.connections[0]!.sendFrame({ opcode: 1, payload: Buffer.alloc(5 * 1024 * 1024, 65) })
    await waitFor(() => seen.closed === 1)
    assert.match(seen.errors[0] ?? '', /too big/)
  })

  it('gives up when the server never answers the handshake', async () => {
    server.silent = true
    const { seen } = open(port, { connectTimeoutMs: 150 })
    await waitFor(() => seen.closed === 1)
    assert.equal(seen.opened, 0)
    assert.match(seen.errors[0] ?? '', /timed out/)
  })

  it('reports a connection that is refused', async () => {
    const free = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port
        s.close(() => resolve(p))
      })
    })
    const { seen } = open(free)
    await waitFor(() => seen.closed === 1)
    assert.equal(seen.opened, 0)
    assert.equal(seen.errors.length, 1)
  })

  it('only speaks ws://', () => {
    assert.throws(() => new WebSocketClient('http://127.0.0.1:1'), /only ws:\/\//)
    assert.throws(() => new WebSocketClient('wss://127.0.0.1:1'), /only ws:\/\//)
  })
})
