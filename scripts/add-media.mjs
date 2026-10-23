// Copies finished media into public/media/<folder>/ in the form Instagram's API accepts, for the post queue.
// PNG images become JPEG (the API refuses PNG); MP4s are copied with their index moved to the front so
// Instagram can start reading them straight away. Usage, from social/:
//   node scripts/add-media.mjs nerves-um ../renders/carousels/nerves-um/{1,2,3,4,5,6}.png
//   node scripts/add-media.mjs overview ../renders/batch-1/Overview-story.mp4=reel ../renders/batch-1/covers/Overview-cover.png=cover
// "file=name" saves it under that name (reel.mp4, cover.jpg); otherwise the file keeps its own name.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

const [folder, ...files] = process.argv.slice(2);
if (!folder || !/^[a-z0-9-]+$/.test(folder) || files.length === 0) {
  console.error("Usage: node scripts/add-media.mjs <folder: a-z 0-9 -> <file[=name]>...");
  process.exit(1);
}
const out = join("public", "media", folder);
mkdirSync(out, { recursive: true });
for (const arg of files) {
  const [file, name] = arg.split("=");
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const video = extname(file).toLowerCase() === ".mp4";
  const target = join(out, `${name ?? basename(file, extname(file)).toLowerCase()}.${video ? "mp4" : "jpg"}`);
  const args = video ? ["-i", file, "-c", "copy", "-movflags", "+faststart"] : ["-i", file, "-q:v", "2"];
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args, target]);
  console.log("saved", target);
}
