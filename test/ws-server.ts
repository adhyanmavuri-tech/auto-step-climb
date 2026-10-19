import { createHash } from 'node:crypto'
import net from 'node:net'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** One client connected to the test server. */
export interface ServerConnection {
  /** The handshake request: its first line and its headers (names in lower case). */
  request: { line: string; headers: Record<string, string> }
  /** The text messages the client sent, decoded. */
  received: string[]
  /** True while every frame the client sent was masked, as the protocol demands of a client. */
  allMasked: boolean
  /** The payloads of the pongs the client sent. */
  pongs: Buffer[]
  /** The status code of the close frame the client sent, once it has. */
  closeCode: number | null
  /** Sends a text message; `split` gives the sizes (in bytes) of the fragments to send it in. */
  sendText(text: string, split?: number[]): void
  sendPing(payload: Buffer): void
  sendClose(code?: number): void
  /** Any frame at all, for the cases a real server would never produce. */
  sendFrame(frame: { fin?: boolean; rsv?: number; opcode: number; payload: Buffer }): void
  end(): void
}

/** A bare-bones WebSocket server for tests: it speaks just enough of the protocol to exercise a client. */
export class TestWsServer {
  readonly connections: ServerConnection[] = []
  onConnection: ((c: ServerConnection) => void) | null = null
  /** Answer the handshake with a wrong Sec-WebSocket-Accept. */
  badAccept = false
  /** Never answer the handshake. */
  silent = false
  /** A Sec-WebSocket-Extensions line to put in the answer, as a server that compresses would. */
  extensions = ''

  private readonly server: net.Server

  constructor() {
    this.server = net.createServer((socket) => this.accept(socket))
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve((this.server.address() as net.AddressInfo).port))
    })
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private readonly sockets = new Set<net.Socket>()

  private accept(socket: net.Socket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => {})
    let head = Buffer.alloc(0)
    let buf = Buffer.alloc(0)
    let conn: ServerConnection | null = null
    let message: Buffer[] = []

    socket.on('data', (chunk) => {
      if (!conn) {
        head = Buffer.concat([head, chunk])
        const end = head.indexOf('\r\n\r\n')
        if (end < 0) return
        const lines = head.subarray(0, end).toString('latin1').split('\r\n')
        const headers: Record<string, string> = {}
        for (const l of lines.slice(1)) {
          const i = l.indexOf(':')
          if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim()
        }
        buf = head.subarray(end + 4)
        if (this.silent) return
        const key = headers['sec-websocket-key'] ?? ''
        const accept = this.badAccept ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' : createHash('sha1').update(key + GUID).digest('base64')
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nServer: test-ws\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${
            this.extensions ? `Sec-WebSocket-Extensions: ${this.extensions}\r\n` : ''
          }\r\n`
        )
        conn = this.makeConnection(socket, { line: lines[0] ?? '', headers })
        this.connections.push(conn)
        this.onConnection?.(conn)
      } else {
        buf = Buffer.concat([buf, chunk])
      }
      // read what the client sent
      for (;;) {
        if (!conn || buf.length < 2) return
        const fin = (buf[0]! & 0x80) !== 0
        const opcode = buf[0]! & 0x0f
        const masked = (buf[1]! & 0x80) !== 0
        let len = buf[1]! & 0x7f
        let at = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          at = 4
        } else if (len === 127) {
          if (buf.length < 10) return
          len = Number(buf.readBigUInt64BE(2))
          at = 10
        }
        if (buf.length < at + 4 + len) return
        if (!masked) conn.allMasked = false
        const mask = buf.subarray(at, at + 4)
        const payload = Buffer.from(Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((v, i) => v ^ mask[i & 3]!))
        buf = buf.subarray(at + 4 + len)
        if (opcode === 8) conn.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        else if (opcode === 10) conn.pongs.push(Buffer.from(payload))
        else if (opcode === 1 || opcode === 0) {
          message.push(Buffer.from(payload))
          if (fin) {
            conn.received.push(Buffer.concat(message).toString('utf8'))
            message = []
          }
        }
      }
    })
  }

  private makeConnection(socket: net.Socket, request: ServerConnection['request']): ServerConnection {
    const frame = (fin: boolean, rsv: number, opcode: number, payload: Buffer): Buffer => {
      const len = payload.length
      const header = len < 126 ? Buffer.alloc(2) : len < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10)
      header[0] = (fin ? 0x80 : 0) | (rsv << 4) | opcode
      if (len < 126) header[1] = len
      else if (len < 65_536) {
        header[1] = 126
        header.writeUInt16BE(len, 2)
      } else {
        header[1] = 127
        header.writeBigUInt64BE(BigInt(len), 2)
      }
      return Buffer.concat([header, payload]) // a server does not mask
    }
    const conn: ServerConnection = {
      request,
      received: [],
      allMasked: true,
      pongs: [],
      closeCode: null,
      sendText(text, split) {
        const bytes = Buffer.from(text, 'utf8')
        if (!split || split.length === 0) return void socket.write(frame(true, 0, 1, bytes))
        let at = 0
        split.forEach((size, i) => {
          socket.write(frame(false, 0, i === 0 ? 1 : 0, bytes.subarray(at, at + size)))
          at += size
        })
        socket.write(frame(true, 0, split.length === 0 ? 1 : 0, bytes.subarray(at)))
      },
      sendPing: (payload) => void socket.write(frame(true, 0, 9, payload)),
      sendClose: (code = 1000) => void socket.write(frame(true, 0, 8, Buffer.from([code >> 8, code & 255]))),
      sendFrame: (f) => void socket.write(frame(f.fin ?? true, f.rsv ?? 0, f.opcode, f.payload)),
      end: () => socket.end()
    }
    return conn
  }
}
