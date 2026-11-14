import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const clampedX = Math.min(Math.max(x, left + radius), right - radius);
  const clampedY = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - clampedX;
  const dy = y - clampedY;
  return dx * dx + dy * dy <= radius * radius;
}

function blend(buffer, width, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const index = (y * width + x) * 4;
  const dstA = buffer[index + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  buffer[index] = Math.round((r * a + buffer[index] * dstA * (1 - a)) / outA);
  buffer[index + 1] = Math.round((g * a + buffer[index + 1] * dstA * (1 - a)) / outA);
  buffer[index + 2] = Math.round((b * a + buffer[index + 2] * dstA * (1 - a)) / outA);
  buffer[index + 3] = Math.round(outA * 255);
}

function renderIcon(size) {
  const scale = 4;
  const width = size * scale;
  const buffer = Buffer.alloc(width * width * 4, 0);

  const radius = width * 0.23;
  const accentTop = [99, 102, 241];
  const accentBottom = [139, 92, 246];

  for (let y = 0; y < width; y += 1) {
    const t = y / width;
    const r = accentTop[0] + (accentBottom[0] - accentTop[0]) * t;
    const g = accentTop[1] + (accentBottom[1] - accentTop[1]) * t;
    const b = accentTop[2] + (accentBottom[2] - accentTop[2]) * t;
    for (let x = 0; x < width; x += 1) {
      if (insideRoundedRect(x + 0.5, y + 0.5, 0, 0, width, width, radius)) {
        blend(buffer, width, x, y, r, g, b, 1);
      }
    }
  }

  for (let y = 0; y < width * 0.36; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (insideRoundedRect(x + 0.5, y + 0.5, 0, 0, width, width, radius)) {
        blend(buffer, width, x, y, 255, 255, 255, 0.07);
      }
    }
  }

  const lineHeight = width * 0.075;
  const lines = [
    { y: 0.3, start: 0.2, end: 0.61 },
    { y: 0.445, start: 0.2, end: 0.69 },
    { y: 0.59, start: 0.2, end: 0.55 },
  ];
  for (const line of lines) {
    const top = width * line.y;
    const left = width * line.start;
    const right = width * line.end;
    const lineRadius = lineHeight / 2;
    for (let y = Math.floor(top); y < Math.ceil(top + lineHeight); y += 1) {
      for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
        if (
          insideRoundedRect(
            x + 0.5,
            y + 0.5,
            left,
            top,
            right,
            top + lineHeight,
            lineRadius,
          )
        ) {
          blend(buffer, width, x, y, 255, 255, 255, 0.94);
        }
      }
    }
  }

  const caretLeft = width * 0.745;
  const caretRight = width * 0.815;
  const caretTop = width * 0.245;
  const caretBottom = width * 0.655;
  const caretRadius = (caretRight - caretLeft) / 2;
  for (let y = Math.floor(caretTop); y < Math.ceil(caretBottom); y += 1) {
    for (let x = Math.floor(caretLeft); x < Math.ceil(caretRight); x += 1) {
      if (
        insideRoundedRect(
          x + 0.5,
          y + 0.5,
          caretLeft,
          caretTop,
          caretRight,
          caretBottom,
          caretRadius,
        )
      ) {
        blend(buffer, width, x, y, 224, 231, 255, 1);
      }
    }
  }

  const output = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * width + (x * scale + sx)) * 4;
          const alpha = buffer[index + 3] / 255;
          r += buffer[index] * alpha;
          g += buffer[index + 1] * alpha;
          b += buffer[index + 2] * alpha;
          a += alpha;
        }
      }
      const samples = scale * scale;
      const outIndex = (y * size + x) * 4;
      if (a > 0) {
        output[outIndex] = Math.round(r / a);
        output[outIndex + 1] = Math.round(g / a);
        output[outIndex + 2] = Math.round(b / a);
      }
      output[outIndex + 3] = Math.round((a / samples) * 255);
    }
  }

  return encodePng(size, size, output);
}

export function generateIcons() {
  mkdirSync(assetsDir, { recursive: true });
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const png = renderIcon(size);
    writeFileSync(path.join(assetsDir, `icon${size}.png`), png);
  }
  return sizes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sizes = generateIcons();
  console.log(`Generated icons: ${sizes.map((size) => `${size}px`).join(", ")}`);
}
