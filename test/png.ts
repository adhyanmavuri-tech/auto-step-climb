import zlib from 'node:zlib'

/** A decoded 8-bit RGBA picture: four bytes per pixel, row by row. */
export interface Picture {
  width: number
  height: number
  rgba: Uint8Array
}

/** Reads the PNGs the tray program writes (8-bit RGBA, no interlacing), so a test can check pixels. */
export function decodePng(file: Buffer): Picture {
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let width = 0
  let height = 0
  const data: Buffer[] = []
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at)
    const type = file.toString('ascii', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('only 8-bit RGBA without interlacing is read here')
    } else if (type === 'IDAT') {
      data.push(body)
    }
    at += 12 + length
  }

  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = width * 4
  const rgba = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[y * stride + x - 4]! : 0
      const up = y > 0 ? rgba[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4]! : 0
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      rgba[y * stride + x] = (line[x]! + add) & 255
    }
  }
  return { width, height, rgba }
}

export const pixel = (pic: Picture, x: number, y: number): [number, number, number, number] => {
  const i = (y * pic.width + x) * 4
  return [pic.rgba[i]!, pic.rgba[i + 1]!, pic.rgba[i + 2]!, pic.rgba[i + 3]!]
}
