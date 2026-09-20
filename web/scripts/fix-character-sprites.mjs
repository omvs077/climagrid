import sharp from "sharp";

const SRC = "public/sprites/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png";
const OUT = "public/sprites/_curated";

const sprites = [
  { name: "character_1.png", box: [371, 2, 380, 16] },
  { name: "character_2.png", box: [371, 99, 381, 112] },
];

for (const s of sprites) {
  const [left, top, right, bottom] = s.box;
  await sharp(SRC)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize((right - left) * 8, (bottom - top) * 8, { kernel: "nearest" })
    .toFile(`${OUT}/${s.name}`);
  console.log(`Wrote ${OUT}/${s.name}`);
}