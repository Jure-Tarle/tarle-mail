// Renders public/brand/tarle-mail-mark.svg into the PNG app icons and favicon.ico.
// Run after changing the mark: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const svg = readFileSync(new URL("public/brand/tarle-mail-mark.svg", root));
const png = (size) => sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 512) * 4) }).resize(size, size).png().toBuffer();

for (const size of [48, 96, 192, 512]) {
	writeFileSync(new URL(`public/icon-${size}.png`, root), await png(size));
}

// An ICO file may embed PNG images directly: a 6-byte header, a 16-byte entry per image, then the images.
const images = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
	const entry = Buffer.alloc(16);
	entry.writeUInt8(size, 0);
	entry.writeUInt8(size, 1);
	entry.writeUInt16LE(1, 4);
	entry.writeUInt16LE(32, 6);
	entry.writeUInt32LE(data.length, 8);
	entry.writeUInt32LE(offset, 12);
	offset += data.length;
	return entry;
});
writeFileSync(new URL("public/favicon.ico", root), Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
console.log("Wrote public/icon-{48,96,192,512}.png and public/favicon.ico");
