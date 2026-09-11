import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "node_modules", "maplibre-gl", "dist");
const destDir = join(root, "public");

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
let missing = false;

for (const file of files) {
  const src = join(srcDir, file);
  const dest = join(destDir, file);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`[maplibre-worker] Copied ${file} to public/`);
  } else {
    console.warn(`[maplibre-worker] WARNING: ${file} not found in maplibre-gl/dist - skipping`);
    missing = true;
  }
}

if (missing) {
  console.warn("[maplibre-worker] Some files were missing. Map worker may fail to load - check maplibre-gl version.");
}