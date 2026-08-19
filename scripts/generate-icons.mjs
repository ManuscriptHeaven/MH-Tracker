import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, drawFn) {
  const rawData = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function drawStandardIcon(x, y, w, h) {
  const normX = x / w;
  const normY = y / h;

  const radius = 0.22;
  const dx = Math.max(0, Math.max(radius - normX, normX - (1 - radius)));
  const dy = Math.max(0, Math.max(radius - normY, normY - (1 - radius)));
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > radius) {
    return [0, 0, 0, 0];
  }

  const borderWidth = 0.04;
  const isBorder = (normX < borderWidth || normX > 1 - borderWidth || normY < borderWidth || normY > 1 - borderWidth);

  let r = 26, g = 26, b = 26, a = 255;

  if (isBorder || (dist > radius - borderWidth && dist <= radius)) {
    return [200, 169, 107, 255];
  }

  const badgeMinX = 0.16;
  const badgeMaxX = 0.84;
  const badgeMinY = 0.16;
  const badgeMaxY = 0.84;

  if (normX >= badgeMinX && normX <= badgeMaxX && normY >= badgeMinY && normY <= badgeMaxY) {
    const inBadgeBorder = (normX <= badgeMinX + 0.02 || normX >= badgeMaxX - 0.02 || normY <= badgeMinY + 0.02 || normY >= badgeMaxY - 0.02);
    if (inBadgeBorder) {
      return [200, 169, 107, 220];
    }

    const inMLeft = normX >= 0.24 && normX <= 0.29 && normY >= 0.28 && normY <= 0.72;
    const inMRight = normX >= 0.43 && normX <= 0.48 && normY >= 0.28 && normY <= 0.72;
    const diagLDist = Math.abs((normY - 0.28) / (0.56 - 0.28) - (normX - 0.26) / (0.36 - 0.26));
    const inMDiagL = normY >= 0.28 && normY <= 0.56 && normX >= 0.26 && normX <= 0.38 && diagLDist < 0.35;
    const diagRDist = Math.abs((normY - 0.28) / (0.56 - 0.28) - (0.46 - normX) / (0.46 - 0.36));
    const inMDiagR = normY >= 0.28 && normY <= 0.56 && normX >= 0.34 && normX <= 0.46 && diagRDist < 0.35;

    const inHLeft = normX >= 0.53 && normX <= 0.58 && normY >= 0.28 && normY <= 0.72;
    const inHRight = normX >= 0.71 && normX <= 0.76 && normY >= 0.28 && normY <= 0.72;
    const inHCross = normX >= 0.53 && normX <= 0.76 && normY >= 0.47 && normY <= 0.53;

    const inMSerifTop = (normX >= 0.22 && normX <= 0.31 && normY >= 0.28 && normY <= 0.31) || (normX >= 0.41 && normX <= 0.50 && normY >= 0.28 && normY <= 0.31);
    const inMSerifBot = (normX >= 0.22 && normX <= 0.31 && normY >= 0.69 && normY <= 0.72) || (normX >= 0.41 && normX <= 0.50 && normY >= 0.69 && normY <= 0.72);

    const inHSerifTop = (normX >= 0.51 && normX <= 0.60 && normY >= 0.28 && normY <= 0.31) || (normX >= 0.69 && normX <= 0.78 && normY >= 0.28 && normY <= 0.31);
    const inHSerifBot = (normX >= 0.51 && normX <= 0.60 && normY >= 0.69 && normY <= 0.72) || (normX >= 0.69 && normX <= 0.78 && normY >= 0.69 && normY <= 0.72);

    if (inMLeft || inMRight || inMDiagL || inMDiagR || inHLeft || inHRight || inHCross || inMSerifTop || inMSerifBot || inHSerifTop || inHSerifBot) {
      return [200, 169, 107, 255];
    }
  }

  return [r, g, b, a];
}

function drawMaskableIcon(x, y, w, h) {
  const normX = x / w;
  const normY = y / h;

  let r = 26, g = 26, b = 26, a = 255;

  const badgeMinX = 0.20;
  const badgeMaxX = 0.80;
  const badgeMinY = 0.20;
  const badgeMaxY = 0.80;

  if (normX >= badgeMinX && normX <= badgeMaxX && normY >= badgeMinY && normY <= badgeMaxY) {
    const inBadgeBorder = (normX <= badgeMinX + 0.02 || normX >= badgeMaxX - 0.02 || normY <= badgeMinY + 0.02 || normY >= badgeMaxY - 0.02);
    if (inBadgeBorder) {
      return [200, 169, 107, 220];
    }

    const inMLeft = normX >= 0.27 && normX <= 0.31 && normY >= 0.31 && normY <= 0.69;
    const inMRight = normX >= 0.44 && normX <= 0.48 && normY >= 0.31 && normY <= 0.69;
    const diagLDist = Math.abs((normY - 0.31) / (0.55 - 0.31) - (normX - 0.29) / (0.375 - 0.29));
    const inMDiagL = normY >= 0.31 && normY <= 0.55 && normX >= 0.29 && normX <= 0.39 && diagLDist < 0.35;
    const diagRDist = Math.abs((normY - 0.31) / (0.55 - 0.31) - (0.46 - normX) / (0.46 - 0.375));
    const inMDiagR = normY >= 0.31 && normY <= 0.55 && normX >= 0.36 && normX <= 0.46 && diagRDist < 0.35;

    const inHLeft = normX >= 0.52 && normX <= 0.56 && normY >= 0.31 && normY <= 0.69;
    const inHRight = normX >= 0.69 && normX <= 0.73 && normY >= 0.31 && normY <= 0.69;
    const inHCross = normX >= 0.52 && normX <= 0.73 && normY >= 0.47 && normY <= 0.53;

    const inMSerifTop = (normX >= 0.25 && normX <= 0.33 && normY >= 0.31 && normY <= 0.33) || (normX >= 0.42 && normX <= 0.50 && normY >= 0.31 && normY <= 0.33);
    const inMSerifBot = (normX >= 0.25 && normX <= 0.33 && normY >= 0.67 && normY <= 0.69) || (normX >= 0.42 && normX <= 0.50 && normY >= 0.67 && normY <= 0.69);

    const inHSerifTop = (normX >= 0.50 && normX <= 0.58 && normY >= 0.31 && normY <= 0.33) || (normX >= 0.67 && normX <= 0.75 && normY >= 0.31 && normY <= 0.33);
    const inHSerifBot = (normX >= 0.50 && normX <= 0.58 && normY >= 0.67 && normY <= 0.69) || (normX >= 0.67 && normX <= 0.75 && normY >= 0.67 && normY <= 0.69);

    if (inMLeft || inMRight || inMDiagL || inMDiagR || inHLeft || inHRight || inHCross || inMSerifTop || inMSerifBot || inHSerifTop || inHSerifBot) {
      return [200, 169, 107, 255];
    }
  }

  return [r, g, b, a];
}

const iconsDir = path.resolve('public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating icon-192.png...');
const icon192 = createPng(192, 192, drawStandardIcon);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);

console.log('Generating icon-512.png...');
const icon512 = createPng(512, 512, drawStandardIcon);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);

console.log('Generating icon-maskable-512.png...');
const iconMaskable = createPng(512, 512, drawMaskableIcon);
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-512.png'), iconMaskable);

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#DFCA96"/>
      <stop offset="50%" stop-color="#C8A96B"/>
      <stop offset="100%" stop-color="#A88746"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#1A1A1A"/>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="none" stroke="url(#goldGrad)" stroke-width="8" opacity="0.85"/>
  <rect x="72" y="72" width="368" height="368" rx="32" fill="#242424" stroke="url(#goldGrad)" stroke-width="4" stroke-opacity="0.4"/>
  <text x="256" y="325" font-family="Georgia, Cambria, 'Times New Roman', serif" font-size="200" font-weight="bold" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="4">MH</text>
  <text x="256" y="390" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#C8A96B" text-anchor="middle" letter-spacing="8" opacity="0.9">TRACKER</text>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent);
console.log('Icons generated successfully in public/icons!');
