/* Just enough PNG to read Chrome's screenshots (8-bit RGB/RGBA, non-interlaced) and measure them. */
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, colorType = 0, depth = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; if (data[12] !== 0) throw new Error('interlaced PNG'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG depth ' + depth);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]; if (!ch) throw new Error('PNG colour type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * ch, out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++], line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * ch;
      if (ch === 4) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
      else if (ch === 3) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; }
      else if (ch === 2) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255; }
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** Mean luminance (0..255), its spread, and the share of near-black pixels in a region. */
export function measure(img, region) {
  const { x = 0, y = 0, w = img.width, h = img.height } = region || {};
  let sum = 0, sum2 = 0, dark = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let yy = y; yy < y + h && yy < img.height; yy += step) for (let xx = x; xx < x + w && xx < img.width; xx += step) {
    const o = (yy * img.width + xx) * 4, l = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    sum += l; sum2 += l * l; if (l < 8) dark++; n++;
  }
  const mean = sum / n;
  return { mean, stddev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), dark: dark / n, samples: n };
}
