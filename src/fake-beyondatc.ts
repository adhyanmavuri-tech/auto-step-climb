import { labelToFeet } from './beyondatc.ts'
import type { SocketLike } from './beyondatc.ts'

/**
 * A stand-in for BeyondATC's toolbar connection, speaking the same messages. Used by the tests and
 * by `npm run demo`, so none of it ever touches a real BeyondATC.
 */
export class FakeBeyondAtc {
  /** The levels the request menu offers. */
  levels: string[]
  /** How the controller answers a level request: clear it, refuse it, or say nothing. */
  reply: 'grant' | 'refuse' | 'silent' = 'grant'
  /** Whether "Request Altitude Change" is on offer at all (it isn't outside the cruise). */
  offered = true
  autoRespond = true
  /**
   * Say nothing until something is asked: on connecting it only names the controller, and it never
   * volunteers a list of what is on offer. That is what the program saw of the real one on the first
   * real flight, when its WebSocket client delivered blanks instead of BeyondATC's messages. The program
   * then has to ask without a list.
   */
  quiet: boolean
  delayMs: number
  /** Everything the program under test sent, in order. */
  readonly received: string[] = []

  private readonly sockets = new Set<FakeSocket>()
  private menuOpen = false

  constructor(init: { levels?: string[]; delayMs?: number; quiet?: boolean } = {}) {
    this.levels = init.levels ?? ['FL320', 'FL340', 'FL360', 'FL380']
    this.delayMs = init.delayMs ?? 5
    this.quiet = init.quiet ?? false
  }

  /** Pass this as `createSocket`. */
  readonly createSocket = (_url: string): SocketLike => {
    const socket = new FakeSocket(this)
    this.sockets.add(socket)
    this.later(() => {
      socket.onopen?.({})
      if (this.quiet) {
        socket.deliver('Facility: Oakland Center|134.150')
        for (let i = 0; i < 3; i++) socket.deliver('')
      } else {
        socket.deliver(this.baseActions())
        socket.deliver(`AutoRespond: ${this.autoRespond}`)
      }
    })
    return socket
  }

  /** The connection breaks, as if BeyondATC had been closed. */
  drop(): void {
    for (const s of this.sockets) s.shut()
    this.sockets.clear()
  }

  handle(frame: string): void {
    this.received.push(frame)
    const m = /^set_action:\s*(.*)$/.exec(frame)
    if (!m) return
    const label = m[1]!.trim()
    if (this.menuOpen) {
      if (/^cancel/i.test(label)) {
        this.menuOpen = false
        this.pushBase()
      } else if (labelToFeet(label) !== null && this.levels.includes(label)) {
        this.menuOpen = false
        if (this.reply === 'grant') {
          this.push(`ATC: roger, new cruise altitude ${label}`)
          this.pushBase()
        } else if (this.reply === 'refuse') {
          this.push(`ATC: unable ${label}, maintain present level`)
          this.pushBase()
        }
      }
      return
    }
    if (this.offered && /^request altitude change$/i.test(label)) {
      this.menuOpen = true
      this.push(`Actions: [Cancel Altitude Change¬${this.levels.join('¬')}¬Say Again¬]`)
    }
  }

  private baseActions(): string {
    return this.offered ? 'Actions: [Request Altitude Change¬Request Direct To¬]' : 'Actions: []'
  }

  /** The list of what is on offer again, which the quiet one does not volunteer. */
  private pushBase(): void {
    if (!this.quiet) this.push(this.baseActions())
  }

  private push(frame: string): void {
    this.later(() => {
      for (const s of this.sockets) s.deliver(frame)
    })
  }

  private later(fn: () => void): void {
    setTimeout(fn, this.delayMs).unref?.()
  }
}

class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  private closed = false
  private readonly server: FakeBeyondAtc

  constructor(server: FakeBeyondAtc) {
    this.server = server
  }

  send(data: string): void {
    if (!this.closed) this.server.handle(data)
  }

  close(): void {
    this.closed = true
  }

  deliver(frame: string): void {
    if (!this.closed) this.onmessage?.({ data: frame })
  }

  /** The server side hangs up. */
  shut(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.({})
  }
}
