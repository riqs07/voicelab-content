import { describe, expect, it } from "vitest";
import { byNumber, captionFrom, headingFrom, humanize, parseReelCaptions } from "./library";
import type { Post } from "./queue";
import type { LibraryItem } from "./library";
import { isLocked, postingSoon, readyToMove, statusOf, unsentChanges, type ServerReport } from "./status";

describe("caption files", () => {
  const batch = "# Batch 1\n\n## 1. Your voice, drawn live\nVideo: `DrawnLive-story.mp4` · Cover: `covers/DrawnLive-cover.png`\n\n```\nSame sentence, said twice.\n\n#publicspeaking\n```\n\n---\n\n## 2. Um rain\nVideo: `UmRain-story.mp4`\n\n```\nHow many?\n```\n";

  it("finds each Reel's title and caption by its video file", () => {
    const found = parseReelCaptions(batch);
    expect(found.get("DrawnLive-story.mp4")).toEqual({ title: "Your voice, drawn live", caption: "Same sentence, said twice.\n\n#publicspeaking" });
    expect(found.get("UmRain-story.mp4")?.title).toBe("Um rain");
  });

  it("reads a carousel's caption.md, or a plain caption.txt", () => {
    const md = '# Carousel: "Um" and "uh" are mistakes. (Myth)\n\nPost them in order.\n\n```\nMyth or fact?\n```\n';
    expect(headingFrom(md)).toBe('"Um" and "uh" are mistakes. (Myth)');
    expect(captionFrom(md)).toBe("Myth or fact?");
    expect(captionFrom("Just the caption\n")).toBe("Just the caption");
  });

  it("names and orders files like a person would", () => {
    expect(humanize("PausePower")).toBe("Pause power");
    expect(humanize("my-trip_2")).toBe("My trip 2");
    expect(["10.png", "2.png", "1.png"].sort(byNumber)).toEqual(["1.png", "2.png", "10.png"]);
  });
});

describe("post status and locking", () => {
  const post: Post = { id: "p", date: "2026-10-30", time: "12:30", source: "carousels/x", kind: "carousel", images: ["media/p/1.jpg"], caption: "Hi" };
  const sent = new Map([["p", post]]);
  const server = (extra: Partial<NonNullable<ServerReport>>): ServerReport => ({ published: {}, lastError: null, posting: null, ...extra });
  const now = { date: "2026-10-30", time: "11:30" };

  it("says where each post is", () => {
    expect(statusOf(post, null, null)).toBe("not-sent");
    expect(statusOf(post, sent, null)).toBe("on-server");
    expect(statusOf({ ...post, caption: "Changed" }, sent, null)).toBe("not-sent");
    expect(statusOf(post, sent, server({ published: { p: { mediaId: "1", at: "" } } }))).toBe("posted");
    expect(statusOf(post, sent, server({ lastError: { postId: "p", message: "x", at: "" } }))).toBe("failed");
  });

  it("locks posts that went out or whose time has passed, but keeps failed ones open", () => {
    expect(isLocked(post, "on-server", now)).toBe(false);
    expect(isLocked(post, "posted", now)).toBe(true);
    expect(isLocked(post, "on-server", { date: "2026-10-30", time: "12:30" })).toBe(true);
    expect(isLocked(post, "failed", { date: "2026-10-31", time: "09:00" })).toBe(false);
  });

  it("warns when a post is due within about an hour and a half", () => {
    expect(postingSoon(post, now)).toBe(true);
    expect(postingSoon(post, { date: "2026-10-30", time: "10:30" })).toBe(false);
    expect(postingSoon(post, { date: "2026-10-30", time: "13:00" })).toBe(false);
  });

  it("counts edits and removals waiting to be sent", () => {
    expect(unsentChanges([post], sent, null)).toBe(0);
    expect(unsentChanges([{ ...post, time: "13:00" }], sent, null)).toBe(1);
    expect(unsentChanges([], sent, null)).toBe(1);
    expect(unsentChanges([], sent, server({ published: { p: { mediaId: "1", at: "" } } }))).toBe(0);
  });
});

describe("readyToMove", () => {
  const item = (key: string, posted = false): LibraryItem => ({ key, kind: "reel", title: key, caption: "", files: [], coverOptions: [], moves: [], posted, problems: [] });
  const post = (id: string, source: string): Post => ({ id, source, date: "2026-10-30", time: "10:00", kind: "reel", video: `media/${id}/reel.mp4`, caption: "x" });

  it("moves an item only once everything scheduled from it has gone out", () => {
    const items = [item("batch-1/A"), item("batch-1/B"), item("batch-1/C"), item("batch-1/D", true)];
    const posts = [post("a1", "batch-1/A"), post("b1", "batch-1/B"), post("b2", "batch-1/B"), post("d1", "batch-1/D")];
    const moving = readyToMove(items, posts, new Set(["a1", "b1", "d1"])).map((entry) => entry.key);
    // A: its only post went out. B: one still waiting. C: never scheduled. D: already in posted/
    expect(moving).toEqual(["batch-1/A"]);
  });
});
