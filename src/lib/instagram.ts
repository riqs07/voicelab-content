// Publishing to Instagram with the Instagram API (Instagram Login, graph.instagram.com).
// Every post is the same three steps: make a "container" for the media, wait until Instagram has
// fetched and processed it, then publish the container. Carousels make one container per image first.
// Kept free of Next.js; fetch and sleep are passed in so the tests can stand in for Instagram.
import { mediaUrl, type Post } from "./queue";

export const GRAPH = "https://graph.instagram.com/v23.0";

export type Deps = {
  token: string;
  // Where this app is served, so Instagram can download the media
  baseUrl: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  // How long to wait for Instagram to process a container (Reels can take a minute or two)
  waitMs?: number;
};

export class InstagramError extends Error {}

// One call to the API. The token goes in the body or query, never in anything we log.
async function call(deps: Deps, method: "GET" | "POST", path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ ...params, access_token: deps.token });
  const url = method === "GET" ? `${GRAPH}/${path}?${query}` : `${GRAPH}/${path}`;
  const init: RequestInit = method === "GET" ? { method } : { method, body: query };
  const answer = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
  if (!answer.ok) {
    const error = body.error as { message?: string; code?: number } | undefined;
    throw new InstagramError(`Instagram said ${answer.status} on ${method} ${path}: ${error?.message ?? "no message"}`);
  }
  return body;
}

// The Instagram account the token belongs to
export async function accountId(deps: Deps): Promise<string> {
  const me = await call(deps, "GET", "me", { fields: "user_id,username" });
  const id = me.user_id ?? me.id;
  if (typeof id !== "string" && typeof id !== "number") throw new InstagramError("Instagram did not say which account the token is for");
  return String(id);
}

async function container(deps: Deps, user: string, params: Record<string, string>): Promise<string> {
  const made = await call(deps, "POST", `${user}/media`, params);
  if (typeof made.id !== "string") throw new InstagramError("Instagram did not return a container id");
  return made.id;
}

// Wait until Instagram has processed a container. FINISHED is ready; ERROR and EXPIRED will never be.
async function waitUntilReady(deps: Deps, id: string): Promise<void> {
  const step = 5_000;
  for (let waited = 0; waited <= (deps.waitMs ?? 240_000); waited += step) {
    const status = await call(deps, "GET", id, { fields: "status_code,status" });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new InstagramError(`Instagram could not process the media: ${String(status.status ?? status.status_code)}`);
    await deps.sleep(step);
  }
  throw new InstagramError("Instagram took too long to process the media; it will be tried again next run");
}

// Publish one post and return Instagram's id for it
export async function publish(post: Post, deps: Deps): Promise<string> {
  const user = await accountId(deps);
  let creation: string;
  if (post.kind === "reel" && post.as === "story") {
    // Stories take no caption or cover; they show full screen for 24 hours
    creation = await container(deps, user, { media_type: "STORIES", video_url: mediaUrl(deps.baseUrl, post.video) });
  } else if (post.kind === "reel") {
    const params: Record<string, string> = { media_type: "REELS", video_url: mediaUrl(deps.baseUrl, post.video), caption: post.caption, share_to_feed: "true" };
    // The cover: a chosen image, else a chosen moment of the video, else Instagram picks
    if (post.cover) params.cover_url = mediaUrl(deps.baseUrl, post.cover);
    else if (post.coverFrame !== undefined) params.thumb_offset = String(Math.round(post.coverFrame * 1000));
    creation = await container(deps, user, params);
  } else if (post.images.length === 1) {
    creation = await container(deps, user, { image_url: mediaUrl(deps.baseUrl, post.images[0] ?? ""), caption: post.caption });
  } else {
    // In order: the carousel shows the images as listed
    const children: string[] = [];
    for (const image of post.images) {
      const child = await container(deps, user, { image_url: mediaUrl(deps.baseUrl, image), is_carousel_item: "true" });
      await waitUntilReady(deps, child);
      children.push(child);
    }
    creation = await container(deps, user, { media_type: "CAROUSEL", children: children.join(","), caption: post.caption });
  }
  await waitUntilReady(deps, creation);
  const published = await call(deps, "POST", `${user}/media_publish`, { creation_id: creation });
  if (typeof published.id !== "string") throw new InstagramError("Instagram did not return the new post's id");
  return published.id;
}

// A token lasts 60 days. Refreshing gives a fresh 60 days; it must be at least a day old to refresh.
export async function refreshToken(deps: Pick<Deps, "token" | "fetch">): Promise<string> {
  const query = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: deps.token });
  const answer = await deps.fetch(`https://graph.instagram.com/refresh_access_token?${query}`, { signal: AbortSignal.timeout(30_000) });
  const body = (await answer.json().catch(() => ({}))) as { access_token?: unknown };
  if (!answer.ok || typeof body.access_token !== "string") throw new InstagramError(`Instagram would not refresh the token (${answer.status})`);
  return body.access_token;
}
