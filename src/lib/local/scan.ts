// Reads renders/ into library items (see library.ts for the folder rules). Runs only on your computer.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { byNumber, captionFrom, headingFrom, humanize, IMAGE, parseReelCaptions, type LibraryItem } from "../library";
import { CAROUSEL_LIMIT } from "../queue";

const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()) : []);
const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);

export function scanLibrary(renders: string): LibraryItem[] {
  const items: LibraryItem[] = [];

  // Batches of Reels: X-story.mp4, with covers/ and captions.md
  for (const batch of folders(renders).filter((name) => name.startsWith("batch-")).sort(byNumber)) {
    const captions = parseReelCaptions(read(join(renders, batch, "captions.md")) ?? "");
    for (const file of readdirSync(join(renders, batch)).filter((name) => name.endsWith("-story.mp4")).sort()) {
      const name = file.replace(/-story\.mp4$/, "");
      const cover = ["png", "jpg"].map((ext) => `${batch}/covers/${name}-cover.${ext}`).find((path) => existsSync(join(renders, path)));
      const listed = captions.get(file);
      items.push({ key: `${batch}/${name}`, kind: "reel", title: listed?.title ?? humanize(name), caption: listed?.caption ?? "", files: [`${batch}/${file}`], cover, problems: [] });
    }
  }

  // Folders of their own: carousels/ and uploads/
  for (const parent of ["carousels", "uploads"]) {
    for (const name of folders(join(renders, parent)).sort()) {
      const dir = join(renders, parent, name);
      const files = readdirSync(dir);
      const text = read(join(dir, "caption.md")) ?? read(join(dir, "caption.txt"));
      const title = (text && headingFrom(text)) || humanize(name);
      const caption = text ? captionFrom(text) : "";
      const videos = files.filter((file) => /\.(mp4|mov|m4v)$/i.test(file));
      const key = `${parent}/${name}`;
      if (videos.length > 0) {
        const video = videos[0] ?? "";
        const cover = files.find((file) => /^cover\.(png|jpe?g)$/i.test(file));
        const problems = video.toLowerCase().endsWith(".mp4") ? [] : [`${video} must be an .mp4 (export it as MP4)`];
        items.push({ key, kind: "reel", title, caption, files: [`${key}/${video}`], cover: cover ? `${key}/${cover}` : undefined, problems });
      } else {
        const images = files.filter((file) => IMAGE.test(file) && !/^cover\./i.test(file)).sort(byNumber);
        if (images.length === 0) continue;
        const problems = images.length > CAROUSEL_LIMIT ? [`${images.length} images; Instagram takes at most ${CAROUSEL_LIMIT}`] : [];
        items.push({ key, kind: "carousel", title, caption, files: images.map((file) => `${key}/${file}`), problems });
      }
    }
  }
  return items;
}
