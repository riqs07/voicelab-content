// The scheduler's work on your computer: reading and saving the queue, copying media from renders/
// into public/media/ (PNG to JPEG with sharp), and sending the schedule to GitHub. Never runs on Vercel.
// File access is marked turbopackIgnore: without the marks the production build would pack the whole
// project (media included) into the server function.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { LibraryItem } from "../library";
import { queueProblems, type Post, type Queue } from "../queue";
import type { ServerReport } from "../status";

const run = promisify(execFile);

// The scheduler runs from social/; renders/ and the git repository are one level up
export const SOCIAL = process.cwd();
export const REPO = resolve(/*turbopackIgnore: true*/ SOCIAL, "..");
export const RENDERS = join(/*turbopackIgnore: true*/ REPO, "renders");
const QUEUE = join(/*turbopackIgnore: true*/ SOCIAL, "src", "data", "queue.json");
const PUBLIC = join(/*turbopackIgnore: true*/ SOCIAL, "public");

// True only when running with "pnpm dev" on your computer
export const isLocal = (): boolean => process.env.NODE_ENV === "development" && !process.env.VERCEL;

export function readQueue(): Queue {
  return JSON.parse(readFileSync(/*turbopackIgnore: true*/ QUEUE, "utf8")) as Queue;
}

function writeQueue(queue: Queue): void {
  const posts = [...queue.posts].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  writeFileSync(/*turbopackIgnore: true*/ QUEUE, `${JSON.stringify({ ...queue, posts }, null, 2)}\n`);
}

// A path under renders/, refusing anything that climbs out of it
export function inRenders(path: string): string {
  const full = resolve(/*turbopackIgnore: true*/ RENDERS, path);
  if (!full.startsWith(RENDERS + sep)) throw new Error("That file isn't in renders/");
  return full;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "post";

const toJpeg = (from: string, to: string) => sharp(from).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toFile(to);

// Schedule a renders/ item: copy its media under its own folder and add it to the queue
export async function createPost(item: LibraryItem, fields: { date: string; time: string; caption: string }): Promise<Post> {
  if (item.problems.length > 0) throw new Error(item.problems.join(/*turbopackIgnore: true*/ "; "));
  const queue = readQueue();
  // Named after the file it came from, e.g. "talkback-2026-10-26"
  const base = `${slug(item.key.split("/").pop() ?? item.title)}-${fields.date}`;
  let id = base;
  for (let n = 2; queue.posts.some((post) => post.id === id) || existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, "media", id)); n += 1) id = `${base}-${n}`;
  const folder = join(/*turbopackIgnore: true*/ PUBLIC, "media", id);
  mkdirSync(/*turbopackIgnore: true*/ folder, { recursive: true });
  let post: Post;
  if (item.kind === "reel") {
    copyFileSync(/*turbopackIgnore: true*/ inRenders(item.files[0] ?? ""), join(/*turbopackIgnore: true*/ folder, "reel.mp4"));
    if (item.cover) await toJpeg(inRenders(item.cover), join(/*turbopackIgnore: true*/ folder, "cover.jpg"));
    post = { id, ...fields, source: item.key, kind: "reel", video: `media/${id}/reel.mp4`, ...(item.cover ? { cover: `media/${id}/cover.jpg` } : {}) };
  } else {
    const images: string[] = [];
    for (const [i, file] of item.files.entries()) {
      await toJpeg(inRenders(file), join(/*turbopackIgnore: true*/ folder, `${i + 1}.jpg`));
      images.push(`media/${id}/${i + 1}.jpg`);
    }
    post = { id, ...fields, source: item.key, kind: "carousel", images };
  }
  writeQueue({ ...queue, posts: [...queue.posts, post] });
  return post;
}

export function updatePost(id: string, fields: { date: string; time: string; caption: string }): void {
  const queue = readQueue();
  if (!queue.posts.some((post) => post.id === id)) throw new Error("That post isn't in the queue any more");
  writeQueue({ ...queue, posts: queue.posts.map((post) => (post.id === id ? { ...post, ...fields } : post)) });
}

export function removePost(id: string): void {
  const queue = readQueue();
  writeQueue({ ...queue, posts: queue.posts.filter((post) => post.id !== id) });
  if (/^[a-z0-9-]+$/.test(id)) rmSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, "media", id), { recursive: true, force: true });
}

const git = async (...args: string[]): Promise<string> => (await run("git", args, { cwd: REPO, timeout: 60_000 })).stdout.trim();

// The queue as GitHub has it, which is what the server posts from. Fetches first; null if offline.
export async function sentQueue(): Promise<Map<string, Post> | null> {
  try {
    await git("fetch", "--quiet", "origin", "main");
    const text = await git("show", "origin/main:social/src/data/queue.json");
    return new Map((JSON.parse(text) as Queue).posts.map((post) => [post.id, post]));
  } catch {
    return null;
  }
}

// Send: commit only the queue and the media to main and push. Vercel redeploys the publisher in a minute or two.
export async function sendSchedule(): Promise<string> {
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new Error(`Your copy is on the branch "${branch}". Switch to main first: git checkout main`);
  const problems = queueProblems(readQueue(), (path) => existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ PUBLIC, path)));
  if (problems.length > 0) throw new Error(problems.join(/*turbopackIgnore: true*/ "\n"));
  await git("pull", "--ff-only", "--quiet", "origin", "main");
  const paths = ["social/src/data/queue.json", "social/public/media"];
  await git("add", "-A", "--", ...paths);
  try {
    await git("diff", "--cached", "--quiet", "--", ...paths);
    return "Nothing new to send.";
  } catch {
    // diff exits non-zero when there are changes, which is what we want
  }
  await git("commit", "--quiet", "-m", "Schedule Instagram posts (from the scheduler)", "--", ...paths);
  await git("push", "--quiet", "origin", "main");
  return "Sent. The server has the new schedule in a minute or two.";
}

// What the publisher says has gone out. Needs SOCIAL_URL and CRON_SECRET in social/.env.local.
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
