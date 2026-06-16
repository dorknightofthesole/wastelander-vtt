#!/usr/bin/env node
/**
 * Generates hexcrawl terrain badges and POI map icons (RGBA PNG).
 * Run: node scripts/generate-hexcrawl-icons.mjs
 */
import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePngRgba(size, pixels) {
  const raw = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) {
    const offset = y * (1 + size * 4);
    raw[offset] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = offset + 1 + x * 4;
      raw[o] = pixels[i];
      raw[o + 1] = pixels[i + 1];
      raw[o + 2] = pixels[i + 2];
      raw[o + 3] = pixels[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createCanvas(size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const idx = (x, y) => (y * size + x) * 4;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < size && y < size;

  const blend = (x, y, r, g, b, a = 255) => {
    if (!inBounds(x, y) || a <= 0) return;
    const i = idx(x, y);
    const srcA = a / 255;
    const dstA = pixels[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    pixels[i] = Math.round((r * srcA + pixels[i] * dstA * (1 - srcA)) / outA);
    pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
    pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
    pixels[i + 3] = Math.round(outA * 255);
  };

  const fillRect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) blend(x, y, ...color);
    }
  };

  const fillCircle = (cx, cy, radius, color) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) blend(x, y, ...color);
      }
    }
  };

  const fillTriangle = (x1, y1, x2, y2, x3, y3, color) => {
    const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2, y3)));
    const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = 0; x < size; x++) {
        const w1 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1);
        const w2 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2);
        const w3 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3);
        const hasNeg = w1 < 0 || w2 < 0 || w3 < 0;
        const hasPos = w1 > 0 || w2 > 0 || w3 > 0;
        if (!(hasNeg && hasPos)) blend(x, y, ...color);
      }
    }
  };

  const strokeRect = (x0, y0, w, h, color, t = 1) => {
    fillRect(x0, y0, w, t, color);
    fillRect(x0, y0 + h - t, w, t, color);
    fillRect(x0, y0, t, h, color);
    fillRect(x0 + w - t, y0, t, h, color);
  };

  return { pixels, fillRect, fillCircle, fillTriangle, strokeRect, blend };
}

function drawRuins(c) {
  const stone = [140, 128, 112, 255];
  const shadow = [88, 78, 68, 255];
  const rubble = [168, 152, 132, 255];
  c.fillRect(10, 34, 18, 22, shadow);
  c.fillRect(12, 18, 8, 16, stone);
  c.fillRect(22, 26, 10, 8, rubble);
  c.fillRect(34, 14, 14, 42, stone);
  c.fillRect(36, 10, 10, 6, rubble);
  c.fillRect(48, 28, 8, 28, shadow);
  c.fillRect(44, 22, 6, 10, stone);
}

function drawCamp(c) {
  const tent = [210, 118, 52, 255];
  const tentDark = [168, 86, 36, 255];
  const pole = [96, 72, 48, 255];
  const fire = [255, 196, 64, 255];
  const fireCore = [255, 120, 32, 255];
  c.fillTriangle(32, 12, 10, 50, 54, 50, tentDark);
  c.fillTriangle(32, 16, 14, 50, 50, 50, tent);
  c.fillRect(31, 12, 2, 38, pole);
  c.fillCircle(32, 54, 5, fire);
  c.fillCircle(32, 54, 2, fireCore);
}

function drawSettlement(c) {
  const wall = [120, 136, 156, 255];
  const roof = [84, 96, 112, 255];
  const window = [255, 220, 120, 255];
  const door = [72, 52, 40, 255];
  c.fillRect(8, 30, 20, 24, wall);
  c.fillRect(6, 22, 24, 8, roof);
  c.fillRect(14, 36, 6, 6, window);
  c.fillRect(14, 46, 8, 8, door);
  c.fillRect(34, 18, 22, 36, wall);
  c.fillRect(32, 10, 26, 8, roof);
  c.fillRect(42, 26, 6, 6, window);
  c.fillRect(42, 38, 6, 6, window);
  c.fillRect(40, 46, 10, 8, door);
}

function drawWater(c) {
  const drop = [56, 148, 220, 255];
  const dropLight = [120, 196, 255, 255];
  const wave = [40, 120, 196, 255];
  c.fillCircle(32, 30, 16, drop);
  c.fillTriangle(32, 8, 18, 30, 46, 30, drop);
  c.fillCircle(26, 26, 5, dropLight);
  c.fillRect(10, 48, 44, 3, wave);
  c.fillRect(14, 54, 36, 3, wave);
  c.fillRect(18, 60, 28, 3, wave);
}

function drawDanger(c) {
  const tri = [220, 56, 48, 255];
  const border = [140, 24, 24, 255];
  const mark = [255, 240, 200, 255];
  c.fillTriangle(32, 8, 8, 56, 56, 56, border);
  c.fillTriangle(32, 14, 14, 52, 50, 52, tri);
  c.fillRect(30, 24, 4, 16, mark);
  c.fillRect(30, 44, 4, 4, mark);
}

function drawQuest(c) {
  const scroll = [236, 208, 128, 255];
  const edge = [184, 152, 72, 255];
  const ink = [96, 64, 32, 255];
  c.fillRect(16, 12, 32, 42, scroll);
  c.strokeRect(16, 12, 32, 42, edge, 2);
  c.fillRect(14, 12, 4, 42, edge);
  c.fillRect(46, 12, 4, 42, edge);
  c.fillRect(22, 22, 20, 3, ink);
  c.fillRect(22, 30, 16, 3, ink);
  c.fillRect(22, 38, 18, 3, ink);
  c.fillCircle(40, 18, 5, [220, 64, 64, 255]);
  c.fillRect(39, 14, 2, 8, [255, 240, 220, 255]);
  c.fillRect(37, 20, 6, 2, [255, 240, 220, 255]);
}

function drawLoot(c) {
  const chest = [168, 112, 48, 255];
  const chestDark = [120, 76, 32, 255];
  const lock = [220, 184, 72, 255];
  const lid = [196, 132, 56, 255];
  c.fillRect(14, 28, 36, 24, chest);
  c.fillRect(14, 28, 36, 8, chestDark);
  c.fillRect(12, 20, 40, 10, lid);
  c.fillRect(12, 18, 40, 4, chestDark);
  c.fillRect(28, 34, 8, 10, lock);
  c.fillRect(30, 36, 4, 6, [96, 72, 32, 255]);
}

function drawLandmark(c) {
  const pin = [176, 88, 200, 255];
  const pinDark = [128, 56, 152, 255];
  const center = [255, 240, 120, 255];
  c.fillCircle(32, 22, 14, pinDark);
  c.fillCircle(32, 22, 11, pin);
  c.fillCircle(32, 22, 5, center);
  c.fillTriangle(32, 34, 24, 52, 40, 52, pinDark);
  c.fillTriangle(32, 36, 26, 50, 38, 50, pin);
}

function drawTerrainOpen(c) {
  c.fillCircle(16, 16, 14, [88, 168, 88, 255]);
  c.fillRect(4, 20, 24, 3, [120, 196, 104, 255]);
  c.fillRect(6, 26, 20, 2, [104, 180, 92, 255]);
}

function drawTerrainNormal(c) {
  c.fillCircle(16, 16, 14, [168, 148, 96, 255]);
  c.fillRect(6, 14, 20, 4, [140, 120, 80, 255]);
  c.fillRect(8, 22, 16, 3, [120, 104, 72, 255]);
}

function drawTerrainRough(c) {
  c.fillCircle(16, 16, 14, [136, 116, 92, 255]);
  c.fillRect(8, 10, 8, 6, [112, 96, 76, 255]);
  c.fillRect(16, 18, 10, 8, [96, 80, 64, 255]);
  c.fillRect(10, 24, 6, 5, [120, 100, 80, 255]);
}

function drawTerrainHard(c) {
  c.fillCircle(16, 16, 14, [120, 104, 104, 255]);
  c.fillTriangle(16, 6, 8, 24, 24, 24, [168, 168, 176, 255]);
  c.fillTriangle(16, 10, 11, 22, 21, 22, [136, 136, 144, 255]);
}

const terrainIcons = [
  ["terrain-open", drawTerrainOpen],
  ["terrain-normal", drawTerrainNormal],
  ["terrain-rough", drawTerrainRough],
  ["terrain-hard", drawTerrainHard],
];

const poiIcons = [
  ["ruins", drawRuins],
  ["camp", drawCamp],
  ["settlement", drawSettlement],
  ["water", drawWater],
  ["danger", drawDanger],
  ["quest", drawQuest],
  ["loot", drawLoot],
  ["landmark", drawLandmark],
];

for (const [name, draw] of terrainIcons) {
  const dir = join(root, "assets/hexcrawl");
  mkdirSync(dir, { recursive: true });
  const canvas = createCanvas(32);
  draw(canvas);
  writeFileSync(join(dir, `${name}.png`), encodePngRgba(32, canvas.pixels));
}

for (const [name, draw] of poiIcons) {
  const dir = join(root, "assets/hexcrawl/hex-icons");
  mkdirSync(dir, { recursive: true });
  const canvas = createCanvas(64);
  draw(canvas);
  writeFileSync(join(dir, `${name}.png`), encodePngRgba(64, canvas.pixels));
}

console.log("Generated hexcrawl terrain badges and POI icons.");
