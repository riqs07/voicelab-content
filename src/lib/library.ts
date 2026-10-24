// What's ready to post: everything finished in renders/. The scheduler only ever posts from here, so a new
// photo or video starts life as a file in renders/ (for your own, a folder in renders/uploads/).
// Once posted, an item's files move to renders/posted/ in the same layout.
//   renders/batch-*/X-story.mp4          a Reel (9:16); its cover is covers/X-cover.png, its caption is in
//                                         captions.md. X-feed.mp4 (4:5, for other platforms) moves with it
//   renders/carousels/<name>/1.png ...   a carousel (or a single photo), caption in caption.md
//   renders/uploads/<name>/              a folder with one .mp4 (a Reel, optional cover.png/.jpg) or images,
//                                         and an optional caption.md or caption.txt
// The parsing here is plain logic; scan.ts reads the folders.

export type LibraryItem = {
  // Folder and name under renders/, e.g. "batch-1/Overview" or "carousels/nerves-um"
  key: string;
  kind: "reel" | "carousel";
  title: string;
  caption: string;
  // Paths under renders/: the video, or the images in order
  files: string[];
  cover?: string;
  // Other images that could be its cover (paths under renders/)
  coverOptions: string[];
  // Everything that moves to renders/posted/ with it: its files, or its whole folder
  moves: string[];
  // In renders/posted/: already on Instagram
  posted: boolean;
  // Anything that would stop it posting (shown in the scheduler, never posted)
  problems: string[];
};

// The text of the first ``` block, which is how our caption files hold the caption
export function firstCodeBlock(markdown: string): string | null {
  const match = /```[^\n]*\n([\s\S]*?)\n```/.exec(markdown);
  return match ? (match[1] ?? "").trim() : null;
}

// A caption file: the code block if there is one, else the whole file without its heading
export function captionFrom(text: string): string {
  return firstCodeBlock(text) ?? text.replace(/^#.*\n+/, "").trim();
}

// The "# Carousel: Title" heading of a caption.md, if any
export function headingFrom(text: string): string | null {
  const match = /^#\s+(?:Carousel:\s*)?(.+)$/m.exec(text);
  return match ? (match[1] ?? "").trim() : null;
}

// A batch's captions.md: one "## N. Title" section per Reel, naming its video file and holding its caption
export function parseReelCaptions(markdown: string): Map<string, { title: string; caption: string }> {
  const found = new Map<string, { title: string; caption: string }>();
  for (const section of markdown.split(/\n(?=## )/)) {
    const heading = /^## (?:\d+\.\s*)?(.+)$/m.exec(section);
    const video = /Video:\s*`([^`]+\.mp4)`/.exec(section);
    const caption = firstCodeBlock(section);
    if (heading && video && caption) found.set(video[1] ?? "", { title: (heading[1] ?? "").trim(), caption });
  }
  return found;
}

// "PausePower" → "Pause power", "my-trip" → "My trip"
export function humanize(name: string): string {
  const words = name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// 1.png, 2.png ... 10.png in number order, not text order
export function byNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export const IMAGE = /\.(png|jpe?g)$/i;
