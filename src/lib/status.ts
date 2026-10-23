// Each post's status in the scheduler, and when it can still be changed. Plain logic, shared by the
// scheduler's API (on your computer) and its tests.
import { when, type Post } from "./queue";

// What the publisher reports (from /api/status), or null when the scheduler isn't connected to it
export type ServerReport = {
  published: Record<string, { mediaId: string; at: string }>;
  lastError: { postId: string; message: string; at: string } | null;
  posting: string | null;
} | null;

export type PostStatus =
  | "posted" // on Instagram
  | "posting" // going out right now
  | "failed" // the last try failed; the next hourly run tries again (up to two days late)
  | "on-server" // sent, and waiting for its time
  | "not-sent"; // only on this computer

// sent: the queue as it is on GitHub (what the server has), or null if that couldn't be read
export function statusOf(post: Post, sent: ReadonlyMap<string, Post> | null, server: ServerReport): PostStatus {
  if (server?.published[post.id]) return "posted";
  if (server?.posting === post.id) return "posting";
  if (server?.lastError?.postId === post.id) return "failed";
  const there = sent?.get(post.id);
  return there && JSON.stringify(there) === JSON.stringify(post) ? "on-server" : "not-sent";
}

const minutes = (post: Pick<Post, "date" | "time">): number => Date.parse(`${post.date}T${post.time}:00Z`) / 60_000;

// Locked: it went out, it's going out, or its time has passed (a failed post stays open so it can be moved)
export function isLocked(post: Post, status: PostStatus, now: { date: string; time: string }): boolean {
  if (status === "posted" || status === "posting") return true;
  return status !== "failed" && when(post) <= when(now);
}

// The clock checks hourly, so a change to a post due within about an hour and a half may arrive too late
export function postingSoon(post: Post, now: { date: string; time: string }): boolean {
  const ahead = minutes(post) - minutes(now);
  return ahead > 0 && ahead <= 90;
}

// How many changes are waiting to be sent: new or edited posts, plus posts removed here but still on the server
export function unsentChanges(local: Post[], sent: ReadonlyMap<string, Post> | null, server: ServerReport): number {
  const here = new Set(local.map((post) => post.id));
  const changed = local.filter((post) => statusOf(post, sent, server) === "not-sent").length;
  const removed = sent ? [...sent.keys()].filter((id) => !here.has(id) && !server?.published[id]).length : 0;
  return changed + removed;
}
