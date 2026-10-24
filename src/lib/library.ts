// What's ready to post: everything in library/, one folder per item. The scheduler only ever posts from here,
// so anything new starts life as a folder in library/. Once posted, the folder moves to library/posted/.
//   library/<name>/<name>.mp4 + cover.png + caption.md     a Reel or Story (9:16 only); other images can be covers
//   library/<name>/1.png 2.png ... + caption.md            a carousel (or one photo), up to 10 images
// The caption is the first ``` block in caption.md (or all of caption.txt); the title is caption.md's # heading.
// The parsing here is plain logic; local/scan.ts reads the folders.

export type LibraryItem = {
  // The folder's name in library/, e.g. "overview" or "nerves-um"
  key: string;
  kind: "reel" | "carousel";
  title: string;
  caption: string;
  // Paths under library/: the video, or the images in order
  files: string[];
  cover?: string;
  // Other images that could be its cover (paths under library/)
  coverOptions: string[];
  // What moves to library/posted/ once it has posted: its folder
  moves: string[];
  // In library/posted/: already on Instagram
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
