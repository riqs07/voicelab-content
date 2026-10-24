// Reads library/ (and library/posted/) into items; see library.ts for the folder rules. Runs only on your
// computer. File access is marked turbopackIgnore so production builds don't pack the project.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { byNumber, captionFrom, headingFrom, humanize, IMAGE, type LibraryItem } from "../library";
import { CAROUSEL_LIMIT } from "../queue";

export const POSTED = "posted";

const folders = (dir: string): string[] => (existsSync(/*turbopackIgnore: true*/ dir) ? readdirSync(/*turbopackIgnore: true*/ dir).filter((name) => statSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, name)).isDirectory()) : []);
const read = (path: string): string | null => (existsSync(/*turbopackIgnore: true*/ path) ? readFileSync(/*turbopackIgnore: true*/ path, "utf8") : null);

// Ready items from library/, then posted ones from library/posted/ (same keys, paths under posted/)
export function scanLibrary(library: string): LibraryItem[] {
  const ready = folders(library).filter((name) => name !== POSTED);
  const posted = folders(join(/*turbopackIgnore: true*/ library, POSTED));
  return [...ready.sort().map((name) => item(library, name, "")), ...posted.sort().map((name) => item(library, name, `${POSTED}/`))].filter((entry): entry is LibraryItem => entry !== null);
}

function item(library: string, name: string, prefix: string): LibraryItem | null {
  const at = `${prefix}${name}`;
  const dir = join(/*turbopackIgnore: true*/ library, at);
  const files = readdirSync(/*turbopackIgnore: true*/ dir);
  const text = read(join(/*turbopackIgnore: true*/ dir, "caption.md")) ?? read(join(/*turbopackIgnore: true*/ dir, "caption.txt"));
  const images = files.filter((file) => IMAGE.test(file)).sort(byNumber);
  const videos = files.filter((file) => /\.(mp4|mov|m4v)$/i.test(file));
  const base = { key: name, title: (text && headingFrom(text)) || humanize(name), caption: text ? captionFrom(text) : "", moves: [at], posted: prefix !== "" };
  if (videos.length > 0) {
    const video = videos[0] ?? "";
    const cover = images.find((file) => /^cover\./i.test(file)) ?? images.find((file) => /cover/i.test(file));
    const problems = [...(video.toLowerCase().endsWith(".mp4") ? [] : [`${video} must be an .mp4 (export it as MP4)`]), ...(videos.length > 1 ? ["more than one video in the folder; keep one"] : [])];
    return { ...base, kind: "reel", files: [`${at}/${video}`], cover: cover ? `${at}/${cover}` : undefined, coverOptions: images.map((file) => `${at}/${file}`), problems };
  }
  if (images.length === 0) return null;
  const problems = images.length > CAROUSEL_LIMIT ? [`${images.length} images; Instagram takes at most ${CAROUSEL_LIMIT}`] : [];
  return { ...base, kind: "carousel", files: images.map((file) => `${at}/${file}`), cover: undefined, coverOptions: [], problems };
}
