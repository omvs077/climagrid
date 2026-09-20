import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";

const SRC = "public/sprites/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png";
const OUT = "public/sprites/_curated";

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sprites = [
  { name: "tree_teal.png", box: [298, 130, 326, 170] },
  { name: "tree_orange.png", box: [298, 170, 326, 210] },
  { name: "character_1.png", box: [370, 2, 390, 30] },
  { name: "character_2.png", box: [370, 95, 392, 112] },
  { name: "car_taxi.png", box: [292, 234, 316, 256] },
];

for (const s of sprites) {
  const [left, top, right, bottom] = s.box;
  await sharp(SRC)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize((right - left) * 6, (bottom - top) * 6, { kernel: "nearest" })
    .toFile(`${OUT}/${s.name}`);
  console.log(`Wrote ${OUT}/${s.name}`);
}