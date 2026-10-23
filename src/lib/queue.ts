// The Instagram post queue: what each post is, checking the queue file, and picking the post that is due now.
// Kept free of Next.js so it can be unit tested. The queue itself is src/data/queue.json.

// Every post has a day and a time in the queue's time zone, and the renders/ item it came from
type Base = { id: string; date: string; time: string; source: string; caption: string };

export type Post =
  // One or more photos (2 or more make a carousel), JPEG only: Instagram's API refuses PNG
  | (Base & { kind: "carousel"; images: string[] })
  // A Reel: an MP4, with an optional JPEG cover
  | (Base & { kind: "reel"; video: string; cover?: string });

export type Queue = { timeZone: string; posts: Post[] };

// Instagram's own limits (posts made through the API)
export const CAPTION_LIMIT = 2200;
export const HASHTAG_LIMIT = 30;
export const CAROUSEL_LIMIT = 10;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
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
    if (!TIME.test(post.time)) problems.push(`${name}: the time must look like 09:30 (24-hour)`);
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

// The date and time where you are, as 2026-10-27 and 14:05, so the queue means your calendar and clock
export function nowIn(timeZone: string, now: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Sorting key: the day, then the time
export const when = (post: Pick<Post, "date" | "time">): string => `${post.date} ${post.time}`;

// A post more than this many days late is skipped, never posted. If the record of what went out
// were ever lost, this stops old posts from going out again.
export const LATE_DAYS = 2;

// The post to publish now: the oldest one whose time has come, up to LATE_DAYS late, that hasn't gone out yet.
// One per run (the clock runs hourly), so two posts due together go out an hour apart instead of in a burst.
export function duePost(queue: Queue, published: ReadonlySet<string>, now: { date: string; time: string }): Post | null {
  const earliest = addDays(now.date, -LATE_DAYS);
  const due = queue.posts.filter((post) => when(post) <= when(now) && post.date >= earliest && !published.has(post.id));
  due.sort((a, b) => when(a).localeCompare(when(b)));
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
