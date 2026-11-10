import { deflateSync, inflateSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [16, 32, 48, 128]
/** Pixels at least this bright, reachable from the edge, are the photo's white backdrop. */
const BACKDROP_LUMA = 238
const PADDING = 0.04
/** Corner rounding, as a fraction of the icon, so the white tile does not read as a box. */
const CORNER = 0.18

const VARIANTS = [
  { suffix: '', drain: 0 },
  // The toolbar icon is the on/off indicator, so the disabled state is a drained copy.
  { suffix: '-off', drain: 1 },
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'extension/public/icons')

function decodePng(buffer) {
  let offset = 8
  const chunks = []
  let header

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    }
    if (type === 'IDAT') chunks.push(data)
    if (type === 'IEND') break
    offset += length + 12
  }

  if (!header || header.depth !== 8 || header.interlace !== 0) {
    throw new Error('Icon source must be a non-interlaced 8-bit PNG')
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) throw new Error(`Unsupported PNG color type ${header.colorType}`)

  const raw = inflateSync(Buffer.concat(chunks))
  const stride = header.width * channels
  const pixels = Buffer.alloc(header.height * stride)

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride)
    unfilter(filter, line, out, previous, channels)
  }

  return { ...header, channels, pixels }
}

function unfilter(filter, line, out, previous, channels) {
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= channels ? out[i - channels] : 0
    const up = previous ? previous[i] : 0
    const upLeft = previous && i >= channels ? previous[i - channels] : 0
    out[i] = (line[i] + filterOffset(filter, left, up, upLeft)) & 0xff
  }
}

function filterOffset(filter, left, up, upLeft) {
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  if (filter === 4) return paeth(left, up, upLeft)
  return 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Flags the white backdrop by flooding in from the edges. The backdrop stays in the icon;
 * this only finds where the subject is, so the crop can be tight.
 */
function keyBackdrop(image) {
  const { width, height, channels, pixels } = image
  const alpha = new Uint8Array(width * height).fill(255)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const consider = (index) => {
    if (alpha[index] === 0) return
    const base = index * channels
    if (luma(pixels[base], pixels[base + 1], pixels[base + 2]) < BACKDROP_LUMA) return
    alpha[index] = 0
    queue[tail++] = index
  }

  for (let x = 0; x < width; x += 1) {
    consider(x)
    consider((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    consider(y * width)
    consider(y * width + width - 1)
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = (index - x) / width
    if (x > 0) consider(index - 1)
    if (x < width - 1) consider(index + 1)
    if (y > 0) consider(index - width)
    if (y < height - 1) consider(index + width)
  }
  return alpha
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function subjectBounds(alpha, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error('Icon source has no visible subject')

  // Square the crop so the photo keeps its proportions inside a square icon.
  const span = Math.max(maxX - minX, maxY - minY) + 1
  return {
    x: (minX + maxX + 1) / 2 - span / 2,
    y: (minY + maxY + 1) / 2 - span / 2,
    span,
  }
}

/** The photo keeps its white backdrop; only the rounded corners fall outside the tile. */
function render(size, image, bounds, variant) {
  const out = new Uint8Array(size * size * 4)
  const inset = size * PADDING
  const scale = bounds.span / (size - inset * 2)
  const corner = size * CORNER

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRounded(x, y, size, corner)) continue

      const sample = sampleBox(
        image,
        bounds.x + (x - inset) * scale,
        bounds.y + (y - inset) * scale,
        scale,
      )
      const offset = (y * size + x) * 4
      const [r, g, b] = drain(sample, variant.drain)
      out[offset] = r
      out[offset + 1] = g
      out[offset + 2] = b
      out[offset + 3] = 255
    }
  }
  return out
}

/** Averages the source box one icon pixel covers, which is what antialiases the shrink. */
function sampleBox(image, left, top, scale) {
  const x0 = Math.max(0, Math.floor(left))
  const y0 = Math.max(0, Math.floor(top))
  const x1 = Math.min(image.width, Math.ceil(left + scale))
  const y1 = Math.min(image.height, Math.ceil(top + scale))
  if (x1 <= x0 || y1 <= y0) return [255, 255, 255]

  let red = 0
  let green = 0
  let blue = 0

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const base = (y * image.width + x) * image.channels
      red += image.pixels[base]
      green += image.pixels[base + 1]
      blue += image.pixels[base + 2]
    }
  }

  const count = (x1 - x0) * (y1 - y0)
  return [Math.round(red / count), Math.round(green / count), Math.round(blue / count)]
}

function insideRounded(x, y, size, corner) {
  const dx = Math.max(corner - x - 0.5, x + 0.5 - (size - corner), 0)
  const dy = Math.max(corner - y - 0.5, y + 0.5 - (size - corner), 0)
  return Math.hypot(dx, dy) <= corner
}

function drain([r, g, b], amount) {
  if (amount === 0) return [r, g, b]
  const gray = luma(r, g, b) * 0.7
  return [mix(r, gray, amount), mix(g, gray, amount), mix(b, gray, amount)]
}

function mix(from, to, amount) {
  return Math.round(from * (1 - amount) + to * amount)
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let code = n
  for (let bit = 0; bit < 8; bit += 1) code = code & 1 ? 0xedb88320 ^ (code >>> 1) : code >>> 1
  return code >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

await mkdir(target, { recursive: true })

const image = decodePng(await readFile(resolve(root, 'extension/icon-source.png')))
const alpha = keyBackdrop(image)
const bounds = subjectBounds(alpha, image.width, image.height)

for (const size of SIZES) {
  for (const variant of VARIANTS) {
    await writeFile(
      resolve(target, `icon${size}${variant.suffix}.png`),
      encodePng(size, render(size, image, bounds, variant)),
    )
  }
}
console.log(`wrote ${SIZES.length * VARIANTS.length} icons from the source image`)
