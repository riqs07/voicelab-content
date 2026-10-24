// The scheduler's work on your computer: reading and saving the queue, copying media from library/
// into public/media/ (PNG to JPEG with sharp), and sending the schedule to GitHub. Never runs on Vercel.
// File access is marked turbopackIgnore: without the marks the production build would pack the whole
// project (media included) into the server function.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { LibraryItem } from "../library";
import { queueProblems, type Post, type Queue } from "../queue";
import { readyToMove, type ServerReport } from "../status";

const run = promisify(execFile);

// The scheduler runs from the repository's own folder, which holds library/ too
export const REPO = process.cwd();
export const LIBRARY = join(/*turbopackIgnore: true*/ REPO, "library");
const QUEUE = join(/*turbopackIgnore: true*/ REPO, "src", "data", "queue.json");
const PUBLIC = join(/*turbopackIgnore: true*/ REPO, "public");

// True only when running with "pnpm dev" on your computer
export const isLocal = (): boolean => process.env.NODE_ENV === "development" && !process.env.VERCEL;

export function readQueue(): Queue {
  return JSON.parse(readFileSync(/*turbopackIgnore: true*/ QUEUE, "utf8")) as Queue;
}

function writeQueue(queue: Queue): void {
  const posts = [...queue.posts].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  writeFileSync(/*turbopackIgnore: true*/ QUEUE, `${JSON.stringify({ ...queue, posts }, null, 2)}\n`);
}

// A path under library/, refusing anything that climbs out of it
export function inLibrary(path: string): string {
  const full = resolve(/*turbopackIgnore: true*/ LIBRARY, path);
  if (!full.startsWith(LIBRARY + sep)) throw new Error("That file isn't in library/");
  return full;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "post";

const toJpeg = (from: string, to: string) => sharp(from).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toFile(to);

// What the person chose in the scheduler
export type Fields = { date: string; time: string; caption: string; as: "reel" | "story" };
// The cover: the item's own cover, another image from its folder, or a moment of the video (seconds)
export type CoverChoice = { kind: "default" } | { kind: "image"; path: string } | { kind: "frame"; seconds: number };

// Copy the chosen cover into the post's folder (or clear it for a frame), returning the post's cover fields
async function applyCover(id: string, item: LibraryItem | undefined, choice: CoverChoice): Promise<Pick<Extract<Post, { kind: "reel" }>, "cover" | "coverSource" | "coverFrame">> {
  const file = join(/*turbopackIgnore: true*/ PUBLIC, "media", id, "cover.jpg");
  if (choice.kind === "frame") {
    rmSync(/*turbopackIgnore: true*/ file, { force: true });
    return { coverFrame: choice.seconds };
  }
  const source = choice.kind === "image" ? choice.path : item?.cover;
  if (!source) {
    rmSync(/*turbopackIgnore: true*/ file, { force: true });
    return {};
  }
  await toJpeg(inLibrary(source), file);
  return { cover: `media/${id}/cover.jpg`, coverSource: source };
}

// Schedule a library/ item: copy its media under its own folder and add it to the queue
export async function createPost(item: LibraryItem, fields: Fields, cover: CoverChoice): Promise<Post> {
  if (item.problems.length > 0) throw new Error(item.problems.join("; "));
  if (item.posted) throw new Error("This has already been posted");
  const queue = readQueue();
  // Named after the file it came from, e.g. "talkback-2026-10-26"
  const base = `${slug(item.key.split("/").pop() ?? item.title)}-${fields.date}`;
  let id = base;
  for (let n = 2; queue.posts.some((post) => post.id === id) || existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, "media", id)); n += 1) id = `${base}-${n}`;
  const folder = join(/*turbopackIgnore: true*/ PUBLIC, "media", id);
  mkdirSync(/*turbopackIgnore: true*/ folder, { recursive: true });
  const { as, ...rest } = fields;
  let post: Post;
  if (item.kind === "reel") {
    copyFileSync(/*turbopackIgnore: true*/ inLibrary(item.files[0] ?? ""), join(/*turbopackIgnore: true*/ folder, "reel.mp4"));
    post = { id, ...rest, source: item.key, kind: "reel", video: `media/${id}/reel.mp4`, ...(as === "story" ? { as } : {}), ...(await applyCover(id, item, cover)) };
  } else {
    const images: string[] = [];
    for (const [i, file] of item.files.entries()) {
      await toJpeg(inLibrary(file), join(/*turbopackIgnore: true*/ folder, `${i + 1}.jpg`));
      images.push(`media/${id}/${i + 1}.jpg`);
    }
    post = { id, ...rest, source: item.key, kind: "carousel", images };
  }
  writeQueue({ ...queue, posts: [...queue.posts, post] });
  return post;
}

// Change a post's day, time, caption, Reel/Story, and (for a Reel) its cover
export async function updatePost(id: string, fields: Fields, cover: CoverChoice | null, item: LibraryItem | undefined): Promise<void> {
  const queue = readQueue();
  const old = queue.posts.find((post) => post.id === id);
  if (!old) throw new Error("That post isn't in the queue any more");
  const { as, ...rest } = fields;
  let next: Post;
  if (old.kind === "reel") {
    const covers = cover ? await applyCover(id, item, cover) : { cover: old.cover, coverSource: old.coverSource, coverFrame: old.coverFrame };
    // Rebuilt field by field so a cleared cover or a switch back to Reel leaves nothing stale behind
    next = { id: old.id, source: old.source, kind: "reel", video: old.video, ...rest, ...(as === "story" ? { as } : {}) };
    if (covers.cover) Object.assign(next, { cover: covers.cover, coverSource: covers.coverSource });
    else if (covers.coverFrame !== undefined) Object.assign(next, { coverFrame: covers.coverFrame });
  } else {
    next = { ...old, ...rest };
  }
  writeQueue({ ...queue, posts: queue.posts.map((post) => (post.id === id ? next : post)) });
}

// Once everything scheduled from an item has gone out, move its folder to library/posted/.
// Returns the titles moved. Items with a post still waiting stay where they are.
export function movePosted(items: LibraryItem[], posts: Post[], posted: ReadonlySet<string>): string[] {
  const moved: string[] = [];
  for (const item of readyToMove(items, posts, posted)) {
    for (const path of item.moves) {
      const from = inLibrary(path);
      const to = inLibrary(`posted/${path}`);
      if (!existsSync(/*turbopackIgnore: true*/ from)) continue;
      mkdirSync(/*turbopackIgnore: true*/ dirname(/*turbopackIgnore: true*/ to), { recursive: true });
      renameSync(/*turbopackIgnore: true*/ from, to);
    }
    moved.push(item.title);
  }
  return moved;
}

export function removePost(id: string): void {
  const queue = readQueue();
  writeQueue({ ...queue, posts: queue.posts.filter((post) => post.id !== id) });
  if (/^[a-z0-9-]+$/.test(id)) rmSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, "media", id), { recursive: true, force: true });
}

const git = async (...args: string[]): Promise<string> => (await run("git", args, { cwd: REPO, timeout: 60_000 })).stdout.trim();

// Bring in anything sent from another computer, once each time the scheduler starts. Only fast-forwards,
// so it never touches unsent work; if it can't (offline, or changes on both sides), Send says so later.
let pulled = false;
export async function pullLatest(): Promise<void> {
  if (pulled) return;
  pulled = true;
  try {
    if ((await git("rev-parse", "--abbrev-ref", "HEAD")) === "main") await git("pull", "--ff-only", "--quiet", "origin", "main");
  } catch {
    // Offline or diverged: carry on with what's here
  }
}

// Whether library/ has changes GitHub doesn't (new items added, posted ones moved); Send takes them along
export async function libraryChanged(): Promise<boolean> {
  try {
    return (await git("status", "--porcelain", "--", "library")) !== "";
  } catch {
    return false;
  }
}

// Whether there are saved schedules that haven't reached GitHub yet (an earlier upload failed)
export async function unpushed(): Promise<boolean> {
  try {
    return Number(await git("rev-list", "--count", "origin/main..HEAD")) > 0;
  } catch {
    return false;
  }
}

// The queue as GitHub has it, which is what the server posts from. Fetches first; null if offline.
export async function sentQueue(): Promise<Map<string, Post> | null> {
  try {
    await git("fetch", "--quiet", "origin", "main");
    const text = await git("show", "origin/main:src/data/queue.json");
    return new Map((JSON.parse(text) as Queue).posts.map((post) => [post.id, post]));
  } catch {
    return null;
  }
}

// Send: commit the queue, the media, and library/ (new items, posted ones moving to library/posted/) to main and push. Vercel redeploys the publisher in a minute or two.
export async function sendSchedule(): Promise<string> {
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new Error(`Your copy is on the branch "${branch}". Switch to main first: git checkout main`);
  const problems = queueProblems(readQueue(), (path) => existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, path)));
  if (problems.length > 0) throw new Error(problems.join("\n"));
  await git("pull", "--ff-only", "--quiet", "origin", "main");
  const paths = ["src/data/queue.json", "public/media", "library"];
  await git("add", "-A", "--", ...paths);
  let staged = true;
  try {
    await git("diff", "--cached", "--quiet", "--", ...paths);
    staged = false;
  } catch {
    // diff exits non-zero when there are changes, which is what we want
  }
  if (staged) await git("commit", "--quiet", "-m", "Schedule Instagram posts (from the scheduler)", "--", ...paths);
  // Also covers a schedule saved by an earlier Send whose upload failed
  if (!staged && !(await unpushed())) return "Nothing new to send.";
  try {
    await git("push", "--quiet", "origin", "main");
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr).trim() : "";
    throw new Error(`The schedule is saved on this computer, but GitHub didn't accept the upload.${detail ? `\nGit said: ${detail}` : ""}\nTry "git push origin main" in this folder to see why; then press Send again.`);
  }
  return "Sent. The server has the new schedule in a minute or two.";
}

// What the publisher says has gone out. Needs SOCIAL_URL and CRON_SECRET in .env.local.
export async function serverReport(): Promise<ServerReport> {
  const url = process.env.SOCIAL_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) return null;
  try {
    const answer = await fetch(`${url.replace(/\/+$/, "")}/api/status`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
    if (!answer.ok) return null;
    const body = (await answer.json()) as NonNullable<ServerReport>;
    return { published: body.published ?? {}, lastError: body.lastError ?? null, posting: body.posting ?? null };
  } catch {
    return null;
  }
}
