// The scheduler's own API, only when it runs on your computer (pnpm dev). On Vercel it doesn't exist.
// GET: the queue, renders/, and each post's status. POST: create, update, remove or send.
import { scanLibrary } from "@/lib/local/scan";
import { createPost, isLocal, movePosted, RENDERS, readQueue, removePost, sendSchedule, sentQueue, serverReport, updatePost, type CoverChoice, type Fields } from "@/lib/local/schedule";
import { nowIn } from "@/lib/queue";
import { isLocked, postingSoon, statusOf, unsentChanges } from "@/lib/status";

const notHere = () => new Response("Not found", { status: 404 });

export async function GET(): Promise<Response> {
  if (!isLocal()) return notHere();
  const queue = readQueue();
  const [sent, server] = await Promise.all([sentQueue(), serverReport()]);
  // Tidy up: anything fully posted moves from renders/ to renders/posted/ (only when the server can confirm it)
  const moved = server ? movePosted(scanLibrary(RENDERS), queue.posts, new Set(Object.keys(server.published))) : [];
  const now = nowIn(queue.timeZone, new Date());
  const posts = queue.posts.map((post) => {
    const status = statusOf(post, sent, server);
    return { post, status, locked: isLocked(post, status, now), soon: postingSoon(post, now), error: status === "failed" ? (server?.lastError?.message ?? null) : null };
  });
  return Response.json({
    timeZone: queue.timeZone,
    now,
    posts,
    library: scanLibrary(RENDERS),
    changes: unsentChanges(queue.posts, sent, server),
    moved,
    github: sent !== null,
    server: server !== null,
  });
}

type Action =
  | { action: "create"; source: string; fields: Fields; cover: CoverChoice }
  | { action: "update"; id: string; fields: Fields; cover: CoverChoice | null }
  | { action: "remove"; id: string }
  | { action: "send" };

export async function POST(request: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const body = (await request.json()) as Action;
  try {
    if (body.action === "send") return Response.json({ ok: true, message: await sendSchedule() });
    const queue = readQueue();
    const now = nowIn(queue.timeZone, new Date());
    if (body.action === "create") {
      const item = scanLibrary(RENDERS).find((entry) => entry.key === body.source);
      if (!item) throw new Error("That item isn't in renders/ any more");
      return Response.json({ ok: true, post: await createPost(item, body.fields, body.cover) });
    }
    // Edits and removals respect the lock: never touch a post that went out or whose time has passed
    const post = queue.posts.find((entry) => entry.id === body.id);
    if (!post) throw new Error("That post isn't in the queue any more");
    const status = statusOf(post, await sentQueue(), await serverReport());
    if (isLocked(post, status, now)) throw new Error("This post has already gone out (or its time has passed), so it can't be changed here.");
    if (body.action === "update") await updatePost(body.id, body.fields, body.cover, scanLibrary(RENDERS).find((entry) => entry.key === post.source));
    else removePost(body.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Something went wrong" }, { status: 400 });
  }
}
