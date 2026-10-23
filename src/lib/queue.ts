// The Instagram post queue: what each post is, checking the queue file, and picking the post that is due today.
// Kept free of Next.js so it can be unit tested. The queue itself is src/data/queue.json.

export type Post =
  // One or more photos (2 or more make a carousel), JPEG only: Instagram's API refuses PNG
  | { id: string; date: string; kind: "carousel"; images: string[]; caption: string }
  // A Reel: an MP4, with an optional JPEG cover
  | { id: string; date: string; kind: "reel"; video: string; cover?: string; caption: string };

export type Queue = { timeZone: string; posts: Post[] };

// Instagram's own limits (posts made through the API)
export const CAPTION_LIMIT = 2200;
export const HASHTAG_LIMIT = 30;
export const CAROUSEL_LIMIT = 10;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9-]+$/;
// Media paths are inside public/, written without a leading slash, e.g. "media/nerves-um/1.jpg"
const MEDIA = /^media\/[a-z0-9-]+\/[a-z0-9-]+\.(jpg|mp4)$/;

// Everything wrong with the queue, in plain words. Empty means it is fine.
// fileExists checks a media path (relative to public/); the tests pass a real check against the disk.
export function queueProblems(queue: Queue, fileExists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  if (!isTimeZone(queue.timeZone)) problems.push(`Unknown time zone "${queue.timeZone}"`);
  const seen = new Set<string>();
  for (const post of queue.posts) {
    const name = `Post "${post.id}"`;
    if (!ID.test(post.id)) problems.push(`${name}: the id may only use a-z, 0-9 and dashes`);
    if (seen.has(post.id)) problems.push(`${name}: the id is used twice`);
    seen.add(post.id);
    if (!DATE.test(post.date) || Number.isNaN(Date.parse(post.date))) problems.push(`${name}: the date must look like 2026-10-27`);
    if (post.caption.trim() === "") problems.push(`${name}: the caption is empty`);
    if (post.caption.length > CAPTION_LIMIT) problems.push(`${name}: the caption is over ${CAPTION_LIMIT} characters`);
    if ((post.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > HASHTAG_LIMIT) problems.push(`${name}: more than ${HASHTAG_LIMIT} hashtags`);
    const media = post.kind === "reel" ? [post.video, ...(post.cover ? [post.cover] : [])] : post.images;
    if (post.kind === "carousel" && (post.images.length < 1 || post.images.length > CAROUSEL_LIMIT)) problems.push(`${name}: a carousel needs 1 to ${CAROUSEL_LIMIT} images`);
    if (post.kind === "carousel" && post.images.some((path) => !path.endsWith(".jpg"))) problems.push(`${name}: images must be .jpg`);
    if (post.kind === "reel" && !post.video.endsWith(".mp4")) problems.push(`${name}: the video must be .mp4`);
    if (post.kind === "reel" && post.cover && !post.cover.endsWith(".jpg")) problems.push(`${name}: the cover must be .jpg`);
    for (const path of media) {
      if (!MEDIA.test(path)) problems.push(`${name}: "${path}" should look like media/<folder>/<name>.jpg`);
      else if (!fileExists(path)) problems.push(`${name}: "${path}" is not in public/`);
    }
  }
  return problems;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Today's date where you are, as 2026-10-27, so "date" in the queue means your calendar day
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// A post more than this many days late is skipped, never posted. If the record of what went out
// were ever lost, this stops old posts from going out again.
export const LATE_DAYS = 2;

// The post to publish now: the oldest one dated today or up to LATE_DAYS earlier that hasn't gone out yet.
// One per run, so a missed day catches up a day later instead of posting a burst.
export function duePost(queue: Queue, published: ReadonlySet<string>, today: string): Post | null {
  const earliest = addDays(today, -LATE_DAYS);
  const due = queue.posts.filter((post) => post.date <= today && post.date >= earliest && !published.has(post.id));
  due.sort((a, b) => a.date.localeCompare(b.date));
  return due[0] ?? null;
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

// The full web address Instagram downloads a media file from
export function mediaUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}
