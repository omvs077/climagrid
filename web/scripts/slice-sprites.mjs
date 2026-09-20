import sharp from "sharp";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const TILE = 16;
const MARGIN = 1; // 1px gap between tiles, per Kenney's spritesheetInfo.txt
const STEP = TILE + MARGIN;

const jobs = [
  {
    src: "public/sprites/kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png",
    outDir: "public/sprites/_sliced/roguelike-rpg",
  },
  {
    src: "public/sprites/kenney_roguelike-characters/Spritesheet/roguelikeChar_transparent.png",
    outDir: "public/sprites/_sliced/roguelike-characters",
  },
];

for (const job of jobs) {
  if (!existsSync(job.outDir)) mkdirSync(job.outDir, { recursive: true });

  const meta = await sharp(job.src).metadata();
  const cols = Math.floor((meta.width + MARGIN) / STEP);
  const rows = Math.floor((meta.height + MARGIN) / STEP);

  console.log(`${job.src}: ${meta.width}x${meta.height} -> ${cols} cols x ${rows} rows`);

  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * STEP;
      const y = r * STEP;
      const outPath = join(job.outDir, `r${String(r).padStart(2, "0")}_c${String(c).padStart(2, "0")}.png`);
      await sharp(job.src)
        .extract({ left: x, top: y, width: TILE, height: TILE })
        .resize(TILE * 4, TILE * 4, { kernel: "nearest" }) // upscale 4x so thumbnails are actually visible
        .toFile(outPath);
      count++;
    }
  }
  console.log(`  Wrote ${count} tiles to ${job.outDir}`);
}