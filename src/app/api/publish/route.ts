// GET /api/publish: run once a day by Vercel Cron (see vercel.json). Publishes the post from
// src/data/queue.json that is due today, if any. Add ?dry=1 to see what it would post without posting.
// Needs, in the hosting settings (never in git): CRON_SECRET, INSTAGRAM_ACCESS_TOKEN, and a connected Blob store.
import queueFile from "@/data/queue.json";
import { InstagramError, publish, refreshToken } from "@/lib/instagram";
import { duePost, mediaUrl, queueProblems, todayIn, type Queue } from "@/lib/queue";
import { claimedByAnotherRun, needsRefresh } from "@/lib/state";
import { loadState, saveState } from "@/lib/store";
import { publicUrl } from "@/lib/publicUrl";

// A Reel can take a few minutes for Instagram to process
export const maxDuration = 300;

const queue = queueFile as Queue;

export async function GET(request: Request): Promise<Response> {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; anyone else is turned away
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  // Only the production deployment posts, so a preview of a branch can never publish
  if (process.env.VERCEL_ENV !== "production") return Response.json({ ok: false, message: "Only the production deployment publishes" }, { status: 403 });

  const problems = queueProblems(queue, () => true);
  if (problems.length > 0) return Response.json({ ok: false, problems }, { status: 500 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ ok: false, message: "No Blob store is connected to the project" }, { status: 503 });

  const now = new Date();
  const today = todayIn(queue.timeZone, now);
  let { state, etag } = await loadState();

  // Keep the token alive: refresh about weekly and keep the new one. A failed refresh isn't fatal
  // (a brand-new token can't be refreshed until it is a day old), so carry on with the one we have.
  let token = state.token?.value ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return Response.json({ ok: false, message: "INSTAGRAM_ACCESS_TOKEN is not set" }, { status: 503 });
  if (needsRefresh(state, now)) {
    try {
      token = await refreshToken({ token, fetch });
      state = { ...state, token: { value: token, refreshedAt: now.toISOString() } };
      const saved = await saveState(state, etag);
      if (saved === null) return Response.json({ ok: false, message: "Another run is working; stopping" }, { status: 409 });
      etag = saved;
    } catch (error) {
      console.error("Social: token refresh failed", error instanceof Error ? error.message : error);
    }
  }

  const post = duePost(queue, new Set(Object.keys(state.published)), today);
  if (!post) return Response.json({ ok: true, today, posted: null });

  const base = publicUrl();
  if (new URL(request.url).searchParams.get("dry") === "1") {
    const media = post.kind === "reel" ? [post.video, ...(post.cover ? [post.cover] : [])] : post.images;
    return Response.json({ ok: true, today, wouldPost: post.id, media: media.map((path) => mediaUrl(base, path)) });
  }

  // Claim the post first: if another run saved in between, it is posting and this one backs off
  if (claimedByAnotherRun(state, now)) return Response.json({ ok: false, message: "Another run is posting" }, { status: 409 });
  const claimed = await saveState({ ...state, claim: { postId: post.id, at: now.toISOString() } }, etag);
  if (claimed === null) return Response.json({ ok: false, message: "Another run is posting" }, { status: 409 });

  try {
    const mediaId = await publish(post, { token, baseUrl: base, fetch, sleep: (ms) => new Promise((done) => setTimeout(done, ms)) });
    // Saving without the claim or the last error clears both
    await saveState({ token: state.token, published: { ...state.published, [post.id]: { mediaId, at: new Date().toISOString() } } }, claimed);
    console.log(`Social: posted ${post.id} as ${mediaId}`);
    return Response.json({ ok: true, today, posted: post.id, mediaId });
  } catch (error) {
    const message = error instanceof InstagramError ? error.message : "Unexpected error while posting";
    console.error(`Social: ${post.id} failed`, error instanceof Error ? error.message : error);
    // Saving without the claim releases it, so tomorrow's run tries again
    await saveState({ token: state.token, published: state.published, lastError: { postId: post.id, message, at: new Date().toISOString() } }, claimed);
    return Response.json({ ok: false, today, failed: post.id, message }, { status: 502 });
  }
}
