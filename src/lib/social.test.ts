import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import queueFile from "@/data/queue.json";
import { GRAPH, InstagramError, publish, refreshToken } from "./instagram";
import { duePost, mediaUrl, queueProblems, todayIn, type Post, type Queue } from "./queue";
import { claimedByAnotherRun, needsRefresh, parseState } from "./state";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const onDisk = (path: string) => existsSync(PUBLIC + path);

const reel: Post = { id: "a", date: "2026-10-27", kind: "reel", video: "media/a/reel.mp4", cover: "media/a/cover.jpg", caption: "Hi #one" };
const carousel: Post = { id: "b", date: "2026-10-29", kind: "carousel", images: ["media/b/1.jpg", "media/b/2.jpg"], caption: "Slides" };
const queue: Queue = { timeZone: "America/New_York", posts: [carousel, reel] };

describe("the real queue file", () => {
  // Runs on every check, so a branch with a broken queue or a missing file can't be merged unnoticed
  it("has no problems and every media file is in public/", () => {
    expect(queueProblems(queueFile as Queue, onDisk)).toEqual([]);
  });
});

describe("queueProblems", () => {
  it("accepts a good queue", () => {
    expect(queueProblems(queue, () => true)).toEqual([]);
  });

  it("names each problem", () => {
    const bad: Queue = {
      timeZone: "Mars/Olympus",
      posts: [
        { ...carousel, images: ["media/b/1.png"], date: "27 Oct" },
        { ...reel, id: "b", caption: " ", video: "media/a/reel.mov" },
      ],
    };
    const problems = queueProblems(bad, () => false).join("\n");
    expect(problems).toContain("Unknown time zone");
    expect(problems).toContain("the date must look like");
    expect(problems).toContain("images must be .jpg");
    expect(problems).toContain("the id is used twice");
    expect(problems).toContain("the caption is empty");
    expect(problems).toContain("the video must be .mp4");
    expect(problems).toContain("is not in public/");
  });

  it("holds Instagram's caption, hashtag and carousel limits", () => {
    const long: Post = { ...carousel, caption: "x".repeat(2201) };
    const tags: Post = { ...carousel, id: "c", caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") };
    const big: Post = { ...carousel, id: "d", images: Array.from({ length: 11 }, (_, i) => `media/b/${i}.jpg`) };
    const problems = queueProblems({ ...queue, posts: [long, tags, big] }, () => true).join("\n");
    expect(problems).toContain("over 2200 characters");
    expect(problems).toContain("more than 30 hashtags");
    expect(problems).toContain("1 to 10 images");
  });
});

describe("todayIn", () => {
  it("uses your calendar day, not the server's", () => {
    // 02:00 UTC on the 28th is still the evening of the 27th in New York
    expect(todayIn("America/New_York", new Date("2026-10-28T02:00:00Z"))).toBe("2026-10-27");
    expect(todayIn("UTC", new Date("2026-10-28T02:00:00Z"))).toBe("2026-10-28");
  });
});

describe("duePost", () => {
  it("picks the oldest due post that hasn't gone out", () => {
    expect(duePost(queue, new Set(), "2026-10-26")).toBe(null);
    expect(duePost(queue, new Set(), "2026-10-29")?.id).toBe("a");
    expect(duePost(queue, new Set(["a"]), "2026-10-29")?.id).toBe("b");
    expect(duePost(queue, new Set(["a", "b"]), "2026-10-30")).toBe(null);
  });

  it("never posts something more than two days late", () => {
    expect(duePost(queue, new Set(), "2026-10-29")?.id).toBe("a");
    expect(duePost(queue, new Set(), "2026-10-30")?.id).toBe("b");
    expect(duePost(queue, new Set(["b"]), "2026-10-30")).toBe(null);
  });
});

describe("mediaUrl", () => {
  it("joins the address and the path once", () => {
    expect(mediaUrl("https://example.com/", "media/a/reel.mp4")).toBe("https://example.com/media/a/reel.mp4");
  });
});

// A stand-in for Instagram that records each call and answers in order
function fakeInstagram(answers: Array<[number, Record<string, unknown>]>) {
  const calls: Array<{ method: string; url: string; params: URLSearchParams }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const params = method === "GET" ? new URL(url).searchParams : (init?.body as URLSearchParams);
    calls.push({ method, url: url.split("?")[0] ?? url, params });
    const [status, body] = answers.shift() ?? [500, { error: { message: "no answer left" } }];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, deps: { token: "tok", baseUrl: "https://example.com", fetch: fetcher, sleep: async () => {} } };
}

describe("publish", () => {
  it("makes a Reel container with its cover, waits, then publishes", async () => {
    const { calls, deps } = fakeInstagram([
      [200, { user_id: "42" }],
      [200, { id: "c1" }],
      [200, { status_code: "IN_PROGRESS" }],
      [200, { status_code: "FINISHED" }],
      [200, { id: "m1" }],
    ]);
    expect(await publish(reel, deps)).toBe("m1");
    expect(calls.map((call) => `${call.method} ${call.url.replace(GRAPH, "")}`)).toEqual(["GET /me", "POST /42/media", "GET /c1", "GET /c1", "POST /42/media_publish"]);
    const made = calls[1]?.params;
    expect(made?.get("media_type")).toBe("REELS");
    expect(made?.get("video_url")).toBe("https://example.com/media/a/reel.mp4");
    expect(made?.get("cover_url")).toBe("https://example.com/media/a/cover.jpg");
    expect(made?.get("caption")).toBe("Hi #one");
    expect(calls[4]?.params.get("creation_id")).toBe("c1");
  });

  it("makes one container per slide, in order, then the carousel", async () => {
    const { calls, deps } = fakeInstagram([
      [200, { user_id: "42" }],
      [200, { id: "s1" }],
      [200, { status_code: "FINISHED" }],
      [200, { id: "s2" }],
      [200, { status_code: "FINISHED" }],
      [200, { id: "car" }],
      [200, { status_code: "FINISHED" }],
      [200, { id: "m2" }],
    ]);
    expect(await publish(carousel, deps)).toBe("m2");
    expect(calls[1]?.params.get("image_url")).toBe("https://example.com/media/b/1.jpg");
    expect(calls[1]?.params.get("is_carousel_item")).toBe("true");
    expect(calls[3]?.params.get("image_url")).toBe("https://example.com/media/b/2.jpg");
    expect(calls[5]?.params.get("media_type")).toBe("CAROUSEL");
    expect(calls[5]?.params.get("children")).toBe("s1,s2");
    expect(calls[5]?.params.get("caption")).toBe("Slides");
  });

  it("stops when Instagram can't process the media, and never publishes it", async () => {
    const { calls, deps } = fakeInstagram([
      [200, { user_id: "42" }],
      [200, { id: "c1" }],
      [200, { status_code: "ERROR", status: "Unsupported video" }],
    ]);
    await expect(publish(reel, deps)).rejects.toThrow("Unsupported video");
    expect(calls.some((call) => call.url.endsWith("media_publish"))).toBe(false);
  });

  it("gives up waiting after the time limit", async () => {
    const { deps } = fakeInstagram([[200, { user_id: "42" }], [200, { id: "c1" }], ...Array.from({ length: 5 }, () => [200, { status_code: "IN_PROGRESS" }] as [number, Record<string, unknown>])]);
    await expect(publish(reel, { ...deps, waitMs: 10_000 })).rejects.toThrow("took too long");
  });

  it("passes on Instagram's error message", async () => {
    const { deps } = fakeInstagram([[400, { error: { message: "Invalid OAuth access token" } }]]);
    await expect(publish(reel, deps)).rejects.toThrow(InstagramError);
  });
});

describe("refreshToken", () => {
  it("returns the new token", async () => {
    const { deps } = fakeInstagram([[200, { access_token: "new", expires_in: 5184000 }]]);
    expect(await refreshToken(deps)).toBe("new");
  });
});

describe("state", () => {
  const now = new Date("2026-10-27T14:00:00Z");

  it("starts empty on a first run, but refuses a damaged file", () => {
    expect(parseState(null)).toEqual({ published: {} });
    expect(() => parseState("{oops")).toThrow();
    expect(() => parseState("{}")).toThrow("damaged");
  });

  it("refreshes the token about weekly", () => {
    expect(needsRefresh({ published: {} }, now)).toBe(true);
    expect(needsRefresh({ published: {}, token: { value: "t", refreshedAt: "2026-10-25T00:00:00Z" } }, now)).toBe(false);
    expect(needsRefresh({ published: {}, token: { value: "t", refreshedAt: "2026-10-10T00:00:00Z" } }, now)).toBe(true);
  });

  it("backs off while another run's claim is fresh", () => {
    expect(claimedByAnotherRun({ published: {} }, now)).toBe(false);
    expect(claimedByAnotherRun({ published: {}, claim: { postId: "a", at: "2026-10-27T13:55:00Z" } }, now)).toBe(true);
    expect(claimedByAnotherRun({ published: {}, claim: { postId: "a", at: "2026-10-27T13:00:00Z" } }, now)).toBe(false);
  });
});
