import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appIcon, DOT_COLORS, encodeIco, encodePng, markIcon, trayIcon } from '../electron/icon-art.ts'
import type { TrayLevel } from '../electron/icon-art.ts'
import { decodePng, pixel } from './png.ts'

describe('icon art', () => {
  it('writes a PNG that reads back as the same pixels', () => {
    const rgba = trayIcon(32, DOT_COLORS.ok)
    const decoded = decodePng(encodePng(32, 32, rgba))
    assert.equal(decoded.width, 32)
    assert.equal(decoded.height, 32)
    assert.deepEqual(pixel(decoded, 23, 9), [0x3d, 0xdc, 0x6e, 255])
  })

  it('shows the status as the colour of the dot, and nothing else changes', () => {
    const colors: Record<TrayLevel, [number, number, number]> = {
      ok: [0x3d, 0xdc, 0x6e],
      busy: [0x38, 0xd5, 0xff],
      attention: [0xff, 0xb0, 0x20],
      problem: [0xff, 0x5c, 0x5c],
      off: [0x8a, 0x94, 0xa3]
    }
    const stairs = pixel(decodePng(encodePng(32, 32, trayIcon(32, DOT_COLORS.ok))), 8, 25)
    for (const level of Object.keys(colors) as TrayLevel[]) {
      const img = decodePng(encodePng(32, 32, trayIcon(32, DOT_COLORS[level])))
      assert.deepEqual(pixel(img, 23, 9).slice(0, 3), colors[level], level)
      assert.deepEqual(pixel(img, 8, 25), stairs, 'the staircase is the same in every colour')
    }
  })

  it('draws the tile with rounded corners and a see-through outside', () => {
    const img = decodePng(encodePng(32, 32, trayIcon(32, DOT_COLORS.ok)))
    assert.equal(pixel(img, 0, 0)[3], 0, 'the corner is empty')
    assert.equal(pixel(img, 16, 28)[3], 255, 'the tile is solid')
  })

  it('works at every size the tray and the installer need', () => {
    for (const size of [16, 24, 32, 48]) {
      const img = decodePng(encodePng(size, size, trayIcon(size, DOT_COLORS.busy)))
      assert.equal(img.width, size)
      const dot = pixel(img, Math.round(size * 0.73), Math.round(size * 0.3))
      assert.deepEqual(dot.slice(0, 3), [0x38, 0xd5, 0xff], `the dot at ${size}`)
    }
    for (const size of [64, 128, 256]) assert.equal(appIcon(size).length, size * size * 4)
  })

  it('draws the mark with the staircase in a gradient from cyan to green', () => {
    const img = decodePng(encodePng(160, 160, markIcon(160)))
    const low = pixel(img, 8 * 4, 29 * 4) // the start of the staircase, bottom left
    const high = pixel(img, 31 * 4, 15 * 4) // the dot at its end
    assert.ok(low[2]! > 200 && low[1]! > 180, `cyan-ish at the start: ${low}`)
    assert.deepEqual(high.slice(0, 3), [0x3d, 0xdc, 0x6e])
  })

  it('packs pictures into an icon file Windows can read', () => {
    const pngs = [16, 32, 256].map((size) => ({ size, png: encodePng(size, size, trayIcon(size, DOT_COLORS.ok)) }))
    const ico = encodeIco(pngs)
    assert.equal(ico.readUInt16LE(2), 1, 'type: icon')
    assert.equal(ico.readUInt16LE(4), 3, 'three pictures')
    assert.equal(ico[6], 16)
    assert.equal(ico[6 + 16], 32)
    assert.equal(ico[6 + 32], 0, '256 is written as 0')
    const offset = ico.readUInt32LE(6 + 12)
    assert.deepEqual([...ico.subarray(offset, offset + 4)], [0x89, 0x50, 0x4e, 0x47], 'the first picture is a PNG')
    assert.equal(ico.length, 6 + 48 + pngs.reduce((n, p) => n + p.png.length, 0))
  })
})
