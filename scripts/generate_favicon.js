// Generates the raster favicon (public/favicon.ico) from scratch -- a
// simple black/white checkerboard, kept in sync with public/favicon.svg's
// design by hand (no image library available in this environment, so this
// hand-rolls a minimal PNG encoder and wraps it in an ICO container rather
// than depending on ImageMagick/sharp/etc. being installed).
//
// Usage: node scripts/generate_favicon.js
// Only needs re-running if the icon's design or site colors change.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INK = [0x11, 0x11, 0x11]; // matches --ink in public/style.css
const PAPER = [0xff, 0xff, 0xff]; // matches --paper

const SIZE = 32;

// CRC32, per the PNG spec.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Same design as favicon.svg: solid ink background, two paper (white)
// squares inset into the top-right and bottom-left quadrants -- a plain
// black/white checkerboard that reads clearly even at 16-32px.
function pixelAt(x, y) {
  const half = SIZE / 2;
  const inTopRight = x >= half + 1 && x <= SIZE - 2 && y >= 1 && y <= half - 2;
  const inBottomLeft = x >= 1 && x <= half - 2 && y >= half + 1 && y <= SIZE - 2;
  return inTopRight || inBottomLeft ? PAPER : INK;
}

function buildPng() {
  const rowBytes = SIZE * 3 + 1; // filter byte + RGB per pixel
  const raw = Buffer.alloc(rowBytes * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixelAt(x, y);
      const off = rowStart + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Wraps the PNG in a single-image ICO container. Modern Windows/browsers
// accept a PNG-compressed image directly inside an ICO (no need to encode
// a legacy BMP DIB).
function buildIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = SIZE === 256 ? 0 : SIZE; // width (0 means 256)
  entry[1] = SIZE === 256 ? 0 : SIZE; // height
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32BE(0, 8); // placeholder, fixed below (needs LE)
  entry.writeUInt32LE(pngBuffer.length, 8); // image data size
  entry.writeUInt32LE(header.length + entry.length, 12); // offset

  return Buffer.concat([header, entry, pngBuffer]);
}

const png = buildPng();
const ico = buildIco(png);

const outDir = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(outDir, 'favicon.ico'), ico);
console.log(`Wrote ${path.join(outDir, 'favicon.ico')} (${ico.length} bytes)`);
