// Reads renders/ (and renders/posted/) into library items; see library.ts for the folder rules. Runs only on
// your computer. File access is marked turbopackIgnore so production builds don't pack the project.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { byNumber, captionFrom, headingFrom, humanize, IMAGE, parseReelCaptions, type LibraryItem } from "../library";
import { CAROUSEL_LIMIT } from "../queue";

const folders = (dir: string): string[] => (existsSync(/*turbopackIgnore: true*/ dir) ? readdirSync(/*turbopackIgnore: true*/ dir).filter((name) => statSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, name)).isDirectory()) : []);
const files = (dir: string): string[] => (existsSync(/*turbopackIgnore: true*/ dir) ? readdirSync(/*turbopackIgnore: true*/ dir) : []);
const read = (path: string): string | null => (existsSync(/*turbopackIgnore: true*/ path) ? readFileSync(/*turbopackIgnore: true*/ path, "utf8") : null);

export const POSTED = "posted";

// Ready items from renders/, then posted ones from renders/posted/ (same keys, paths under posted/)
export function scanLibrary(renders: string): LibraryItem[] {
  return [...scanIn(renders, "", renders), ...scanIn(join(/*turbopackIgnore: true*/ renders, POSTED), `${POSTED}/`, renders)];
}

// root: the folder to read; prefix: its path under renders/ ("" or "posted/"); renders: for captions.md,
// which stays in renders/batch-*/ when a Reel moves out
function scanIn(root: string, prefix: string, renders: string): LibraryItem[] {
  const items: LibraryItem[] = [];
  const posted = prefix !== "";

  // Batches of Reels: X-story.mp4, with covers/ and captions.md
  for (const batch of folders(root).filter((name) => name.startsWith("batch-")).sort(byNumber)) {
    const here = files(join(/*turbopackIgnore: true*/ root, batch));
    const covers = files(join(/*turbopackIgnore: true*/ root, batch, "covers")).filter((file) => IMAGE.test(file));
    const captions = parseReelCaptions(read(join(/*turbopackIgnore: true*/ renders, batch, "captions.md")) ?? read(join(/*turbopackIgnore: true*/ root, batch, "captions.md")) ?? "");
    for (const file of here.filter((name) => name.endsWith("-story.mp4")).sort()) {
      const name = file.replace(/-story\.mp4$/, "");
      const at = `${prefix}${batch}`;
      const own = covers.filter((cover) => cover.startsWith(`${name}-`) || cover.startsWith(`${name}.`)).map((cover) => `${at}/covers/${cover}`);
      const cover = own.find((path) => /-cover\.(png|jpe?g)$/i.test(path)) ?? own[0];
      const feed = here.includes(`${name}-feed.mp4`) ? [`${at}/${name}-feed.mp4`] : [];
      const listed = captions.get(file);
      items.push({
        key: `${batch}/${name}`,
        kind: "reel",
        title: listed?.title ?? humanize(name),
        caption: listed?.caption ?? "",
        files: [`${at}/${file}`],
        cover,
        coverOptions: own,
        moves: [`${at}/${file}`, ...feed, ...own],
        posted,
        problems: [],
      });
    }
  }

  // Folders of their own: carousels/ and uploads/
  for (const parent of ["carousels", "uploads"]) {
    for (const name of folders(join(/*turbopackIgnore: true*/ root, parent)).sort()) {
      const dir = join(/*turbopackIgnore: true*/ root, parent, name);
      const inside = files(dir);
      const text = read(join(/*turbopackIgnore: true*/ dir, "caption.md")) ?? read(join(/*turbopackIgnore: true*/ dir, "caption.txt"));
      const title = (text && headingFrom(text)) || humanize(name);
      const caption = text ? captionFrom(text) : "";
      const at = `${prefix}${parent}/${name}`;
      const images = inside.filter((file) => IMAGE.test(file)).sort(byNumber);
      const videos = inside.filter((file) => /\.(mp4|mov|m4v)$/i.test(file));
      const base = { key: `${parent}/${name}`, title, caption, moves: [at], posted };
      if (videos.length > 0) {
        const video = videos[0] ?? "";
        const cover = images.find((file) => /^cover\./i.test(file));
        const problems = video.toLowerCase().endsWith(".mp4") ? [] : [`${video} must be an .mp4 (export it as MP4)`];
        items.push({ ...base, kind: "reel", files: [`${at}/${video}`], cover: cover ? `${at}/${cover}` : undefined, coverOptions: images.map((file) => `${at}/${file}`), problems });
      } else {
        const slides = images.filter((file) => !/^cover\./i.test(file));
        if (slides.length === 0) continue;
        const problems = slides.length > CAROUSEL_LIMIT ? [`${slides.length} images; Instagram takes at most ${CAROUSEL_LIMIT}`] : [];
        items.push({ ...base, kind: "carousel", files: slides.map((file) => `${at}/${file}`), cover: undefined, coverOptions: [], problems });
      }
    }
  }
  return items;
}
