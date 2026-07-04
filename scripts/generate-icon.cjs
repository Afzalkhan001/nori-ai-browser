// Generates build/icon.png — a 512×512 branded mark (porcelain field, moss disc,
// cream inner dot) with no image deps. electron-builder derives .ico/.icns from it.
const zlib = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const S = 512
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const PORCELAIN = hex('#f6f3ec')
const MOSS = hex('#34503e')
const CREAM = hex('#e9e4d6')

// Per-pixel: porcelain field, a large moss disc, a small cream dot inside it.
const cx = S / 2
const cy = S / 2
const rDisc = S * 0.36
const rDot = S * 0.12
const dotY = cy - S * 0.11

const raw = Buffer.alloc(S * (S * 4 + 1))
let p = 0
for (let y = 0; y < S; y++) {
  raw[p++] = 0 // filter byte per scanline
  for (let x = 0; x < S; x++) {
    const dDisc = Math.hypot(x - cx, y - cy)
    const dDot = Math.hypot(x - cx, y - dotY)
    let c
    if (dDot <= rDot) c = CREAM
    else if (dDisc <= rDisc) c = MOSS
    else c = PORCELAIN
    // Antialias the disc edge a touch.
    const edge = rDisc - dDisc
    if (edge > 0 && edge < 1.5 && dDot > rDot) {
      const t = edge / 1.5
      c = c.map((v, i) => Math.round(v * t + PORCELAIN[i] * (1 - t)))
    }
    raw[p++] = c[0]
    raw[p++] = c[1]
    raw[p++] = c[2]
    raw[p++] = 255
  }
}

// --- minimal PNG encoder ---
const crcTable = (() => {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const dir = join(__dirname, '..', 'build')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.png'), png)
console.log('wrote build/icon.png', png.length, 'bytes')
