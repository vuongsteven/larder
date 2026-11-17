// Render the PNG icons the web manifest and iOS need from public/favicon.svg.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/favicon.svg");
const bg = "#2c6a4c";

async function plain(size: number, out: string) {
  await sharp(svg, { density: 400 }).resize(size, size).png().toFile(out);
}

// Maskable and Apple icons are cropped by the OS, so pad the mark onto a full-bleed square.
async function padded(size: number, scale: number, out: string) {
  const inner = Math.round(size * scale);
  const mark = await sharp(svg, { density: 400 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(out);
}

await plain(192, "public/icon-192.png");
await plain(512, "public/icon-512.png");
await padded(512, 0.8, "public/icon-maskable-512.png");
await padded(180, 0.92, "public/apple-touch-icon.png");
console.log("icons written");
