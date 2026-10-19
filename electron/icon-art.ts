/**
 * Draws the app's icons: the staircase from the dashboard on a dark tile. No image tools are needed: every
 * shape is a distance function, and each pixel is the average of a grid of samples, which gives smooth edges.
 *
 *  - tray icons: the staircase with a coloured dot whose colour says how things are (the same drawing as the
 *    small tray program of the command-line version, so the two read the same)
 *  - the app icon: the dashboard's mark, with the staircase in the cyan-to-green gradient
 *
 * scripts/build-icons.ts writes the pictures. Nothing here runs inside the app.
 */

import { deflateSync } from 'node:zlib'

export type TrayLevel = 'ok' | 'busy' | 'attention' | 'problem' | 'off'

/** The dot colours, as in tray-status.ts: green ok, cyan busy, amber attention, red problem, grey off. */
export const DOT_COLORS: Record<TrayLevel, string> = {
  ok: '#3ddc6e',
  busy: '#38d5ff',
  attention: '#ffb020',
  problem: '#ff5c5c',
  off: '#8a94a3'
}

type Rgb = [number, number, number]
type Point = [number, number]

const INK: Rgb = [0x0d, 0x12, 0x18]

function hex(color: string): Rgb {
  const n = Number.parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** One thing to draw: where it covers (a distance, negative inside) and what colour it is there. */
interface Shape {
  /** Signed distance to the shape's edge in design units: negative inside, positive outside. */
  dist: (x: number, y: number) => number
  color: (x: number, y: number) => Rgb
  /** A fill covers where dist <= 0. A stroke covers where the distance to the edge is within half the width. */
  halfWidth?: number
}

const solid = (rgb: Rgb) => (): Rgb => rgb

function circle(cx: number, cy: number, r: number): (x: number, y: number) => number {
  return (x, y) => Math.hypot(x - cx, y - cy) - r
}

function roundRect(x0: number, y0: number, w: number, h: number, r: number): (x: number, y: number) => number {
  const cx = x0 + w / 2
  const cy = y0 + h / 2
  return (x, y) => {
    const qx = Math.abs(x - cx) - (w / 2 - r)
    const qy = Math.abs(y - cy) - (h / 2 - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
}

/** Distance to a line of segments: with a half width, a stroke with round joins and round ends. */
function polyline(points: Point[]): (x: number, y: number) => number {
  return (x, y) => {
    let best = Infinity
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i]!
      const [bx, by] = points[i + 1]!
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
    }
    return best
  }
}

const fill = (dist: Shape['dist'], rgb: Rgb): Shape => ({ dist, color: solid(rgb) })
const stroke = (dist: Shape['dist'], width: number, color: Shape['color']): Shape => ({ dist, color, halfWidth: width / 2 })
/** A ring along the edge of a filled shape: half inside it and half outside, like a pen drawn along its outline. */
const outline = (dist: Shape['dist'], width: number, rgb: Rgb): Shape => ({ dist: (x, y) => Math.abs(dist(x, y)), color: solid(rgb), halfWidth: width / 2 })

function covers(s: Shape, x: number, y: number): boolean {
  return s.halfWidth === undefined ? s.dist(x, y) <= 0 : s.dist(x, y) <= s.halfWidth
}

/** Draws shapes, in order, on a transparent square `size` pixels wide; `design` is how many units the shapes are drawn in. */
function render(shapes: Shape[], design: number, size: number, samples = 6): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const unit = design / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) * unit
          const y = (py + (sy + 0.5) / samples) * unit
          let found: Rgb | null = null
          for (let i = shapes.length - 1; i >= 0; i--) {
            if (covers(shapes[i]!, x, y)) {
              found = shapes[i]!.color(x, y)
              break
            }
          }
          if (found) {
            r += found[0]
            g += found[1]
            b += found[2]
            a++
          }
        }
      }
      const n = samples * samples
      const o = (py * size + px) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round((a / n) * 255)
      }
    }
  }
  return out
}

// ---- the pictures -------------------------------------------------------------------------

const STAIRS_BOLD: Point[] = [
  [5.5, 25],
  [12, 25],
  [12, 18.5],
  [19, 18.5],
  [19, 12],
  [22, 12]
]

/** The tray icon (and the app icon at small sizes): the staircase with a big dot. The colour is the message. */
export function trayIcon(size: number, dot: string): Uint8Array {
  const tile = roundRect(1, 1, 30, 30, 7)
  const dotShape = circle(23.5, 9.5, 6)
  return render(
    [
      fill(tile, INK),
      outline(tile, 1.4, hex('#465a6e')),
      stroke(polyline(STAIRS_BOLD), 3.8, solid(hex('#b4c6d8'))),
      fill(dotShape, hex(dot)),
      outline(dotShape, 1.6, INK)
    ],
    32,
    size
  )
}

const STAIRS_MARK: Point[] = [
  [8, 29],
  [15, 29],
  [15, 22],
  [23, 22],
  [23, 15],
  [32, 15]
]

/** The dashboard's mark: a dark tile, the staircase in a cyan-to-green gradient, and a green dot at the top. */
export function markIcon(size: number): Uint8Array {
  const tile = roundRect(1, 1, 38, 38, 9)
  const from = hex('#38d5ff')
  const to = hex('#3ddc6e')
  // The gradient runs from the bottom left of the staircase's box to its top right, as in the dashboard.
  const gradient = (x: number, y: number): Rgb => {
    const t = Math.max(0, Math.min(1, ((x - 8) / 24 - (y - 15) / 14 + 1) / 2))
    return [0, 1, 2].map((i) => Math.round(from[i]! + (to[i]! - from[i]!) * t)) as Rgb
  }
  return render(
    [fill(tile, hex('#0d1218')), outline(tile, 1.5, hex('#2a3747')), stroke(polyline(STAIRS_MARK), 3.2, gradient), fill(circle(32, 15, 2.8), to)],
    40,
    size
  )
}

/** The app icon at a size: the mark when there is room for its thin lines, the bold staircase when there is not. */
export function appIcon(size: number): Uint8Array {
  return size >= 64 ? markIcon(size) : trayIcon(size, DOT_COLORS.ok)
}

// ---- file formats -------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** A PNG file (8 bits per channel, with transparency) from RGBA pixels. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A Windows icon file holding these PNG pictures (square, 256 pixels at most). */
export function encodeIco(pngs: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(pngs.length, 4)
  const entries = Buffer.alloc(16 * pngs.length)
  let offset = 6 + entries.length
  pngs.forEach(({ size, png }, i) => {
    const o = i * 16
    entries[o] = size >= 256 ? 0 : size
    entries[o + 1] = size >= 256 ? 0 : size
    entries.writeUInt16LE(1, o + 4) // colour planes
    entries.writeUInt16LE(32, o + 6) // bits per pixel
    entries.writeUInt32LE(png.length, o + 8)
    entries.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([head, entries, ...pngs.map((p) => p.png)])
}
