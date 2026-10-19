import { createHash, randomBytes } from 'node:crypto'
import net from 'node:net'
import type { SocketLike } from './beyondatc.ts'

/**
 * A small WebSocket client (RFC 6455, text messages, ws:// only) for talking to a program on this PC.
 *
 * It exists because BeyondATC's toolbar server agrees to "permessage-deflate" whenever a client offers it,
 * and Node's built-in WebSocket always does: BeyondATC then compresses every message, and Node hands the
 * program empty strings instead of them. Found on a real flight (2026-10-17): the app asked for a level
 * change but never saw the menu BeyondATC answered with, so it never chose a level. This client offers no
 * extensions, so BeyondATC sends plain text, and it refuses any frame that claims to use one.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** A message bigger than this is refused. BeyondATC's largest (its settings) is about a kilobyte. */
const MAX_MESSAGE = 4 * 1024 * 1024

export interface WebSocketClientOptions {
  /** Give up if the connection and handshake are not done by then. */
  connectTimeoutMs?: number
}

export class WebSocketClient implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  private readonly socket: net.Socket
  private readonly key = randomBytes(16).toString('base64')
  private state: 'connecting' | 'open' | 'closed' = 'connecting'
  private pending: Buffer = Buffer.alloc(0)
  /** The pieces of the message being received, and its type (1 text, 2 binary, 0 none yet). */
  private pieces: Buffer[] = []
  private pieceType = 0
  private pieceBytes = 0
  private closeEmitted = false
  private timer: NodeJS.Timeout | null

  constructor(url: string, opts: WebSocketClientOptions = {}) {
    const u = new URL(url)
    if (u.protocol !== 'ws:') throw new Error(`only ws:// is supported, not ${u.protocol}`)
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const port = u.port === '' ? 80 : Number(u.port)
    const path = `${u.pathname === '' ? '/' : u.pathname}${u.search}`

    this.socket = net.connect({ host, port })
    this.socket.setNoDelay(true)
    this.timer = setTimeout(() => this.fail('timed out waiting for the connection'), opts.connectTimeoutMs ?? 5000)
    this.timer.unref?.()
    this.socket.on('connect', () => {
      // No Sec-WebSocket-Extensions line: nothing is offered, so nothing is compressed.
      this.socket.write(`GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${this.key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk))
    this.socket.on('error', (err) => this.fail(err.message))
    this.socket.on('close', () => this.finish())
  }

  /** Sends a text message. Throws if the connection is not open. */
  send(data: string): void {
    if (this.state !== 'open') throw new Error('the connection is not open')
    this.sendFrame(1, Buffer.from(data, 'utf8'))
  }

  close(): void {
    if (this.state === 'open') {
      try {
        this.sendFrame(8, Buffer.from([0x03, 0xe8])) // 1000: normal closure
      } catch {
        // already gone
      }
    }
    this.socket.end()
    setTimeout(() => this.socket.destroy(), 500).unref?.()
    this.finish()
  }

  // ---- receiving -------------------------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    if (this.state === 'connecting') {
      const end = this.pending.indexOf('\r\n\r\n')
      if (end < 0) {
        if (this.pending.length > 16_384) this.fail('the answer to the handshake is too long')
        return
      }
      const problem = this.checkHandshake(this.pending.subarray(0, end).toString('latin1'))
      this.pending = this.pending.subarray(end + 4)
      if (problem) return this.fail(problem)
      this.state = 'open'
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.onopen?.({})
    }
    if (this.state === 'open') this.readFrames()
  }

  /** Null when the server agreed to a plain WebSocket, otherwise what was wrong. */
  private checkHandshake(head: string): string | null {
    const lines = head.split('\r\n')
    if (!/^HTTP\/1\.1 101\b/.test(lines[0] ?? '')) return `the server did not switch to WebSocket (${lines[0] ?? 'no answer'})`
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':')
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
    }
    if ((headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return 'the server did not agree to upgrade to WebSocket'
    const expected = createHash('sha1').update(this.key + GUID).digest('base64')
    if (headers.get('sec-websocket-accept') !== expected) return 'the server answered the handshake wrongly'
    if (headers.has('sec-websocket-extensions')) return 'the server chose an extension that was not offered'
    return null
  }

  private readFrames(): void {
    while (this.state === 'open') {
      const b = this.pending
      if (b.length < 2) return
      const fin = (b[0]! & 0x80) !== 0
      const rsv = (b[0]! >> 4) & 7
      const opcode = b[0]! & 0x0f
      const masked = (b[1]! & 0x80) !== 0
      let len = b[1]! & 0x7f
      let at = 2
      if (len === 126) {
        if (b.length < 4) return
        len = b.readUInt16BE(2)
        at = 4
      } else if (len === 127) {
        if (b.length < 10) return
        const big = b.readBigUInt64BE(2)
        if (big > BigInt(MAX_MESSAGE)) return this.fail('a message is too big')
        len = Number(big)
        at = 10
      }
      if (rsv !== 0) return this.fail('a frame used an extension that was not agreed (compression?)')
      if (len > MAX_MESSAGE) return this.fail('a message is too big')
      const maskLen = masked ? 4 : 0
      if (b.length < at + maskLen + len) return
      let payload = b.subarray(at + maskLen, at + maskLen + len)
      if (masked) payload = xor(payload, b.subarray(at, at + 4)) // servers should not mask, but it is harmless
      this.pending = b.subarray(at + maskLen + len)
      this.onFrame(fin, opcode, payload)
    }
  }

  private onFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode >= 8) {
      if (!fin || payload.length > 125) return this.fail('a control frame was malformed')
      if (opcode === 9) this.sendFrame(10, payload) // ping: answer with the same bytes
      else if (opcode === 8) {
        try {
          this.sendFrame(8, payload.subarray(0, 2))
        } catch {
          // already gone
        }
        this.socket.end()
        this.finish()
      }
      return // a pong needs nothing
    }
    if (opcode === 0) {
      if (this.pieceType === 0) return this.fail('a frame continued a message that was not begun')
    } else if (opcode === 1 || opcode === 2) {
      if (this.pieceType !== 0) return this.fail('a new message began before the last one ended')
      this.pieceType = opcode
      this.pieces = []
      this.pieceBytes = 0
    } else {
      return this.fail(`unknown frame type ${opcode}`)
    }
    this.pieceBytes += payload.length
    if (this.pieceBytes > MAX_MESSAGE) return this.fail('a message is too big')
    this.pieces.push(payload)
    if (!fin) return
    const whole = Buffer.concat(this.pieces)
    const type = this.pieceType
    this.pieces = []
    this.pieceType = 0
    this.pieceBytes = 0
    if (type === 1) this.onmessage?.({ data: whole.toString('utf8') })
  }

  // ---- sending and ending ----------------------------------------------------------------

  /** Client frames must be masked. */
  private sendFrame(opcode: number, payload: Buffer): void {
    const len = payload.length
    const header = len < 126 ? Buffer.alloc(2) : len < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10)
    header[0] = 0x80 | opcode
    if (len < 126) {
      header[1] = 0x80 | len
    } else if (len < 65_536) {
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    const mask = randomBytes(4)
    this.socket.write(Buffer.concat([header, mask, xor(payload, mask)]))
  }

  private fail(message: string): void {
    if (this.state === 'closed') return
    this.onerror?.({ message })
    this.socket.destroy()
    this.finish()
  }

  private finish(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.state = 'closed'
    if (this.closeEmitted) return
    this.closeEmitted = true
    this.onclose?.({})
  }
}

function xor(data: Buffer, mask: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ mask[i & 3]!
  return out
}
