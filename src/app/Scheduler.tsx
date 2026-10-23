"use client";
// The post scheduler you run on your computer: renders/ on the left, the week in the middle, the post on the right.
// Everything it changes is saved on this computer until "Send to server".
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "@/lib/library";
import { CAPTION_LIMIT, HASHTAG_LIMIT, type Post } from "@/lib/queue";
import type { PostStatus } from "@/lib/status";

type Entry = { post: Post; status: PostStatus; locked: boolean; soon: boolean; error: string | null };
type Data = { timeZone: string; now: { date: string; time: string }; posts: Entry[]; library: LibraryItem[]; changes: number; github: boolean; server: boolean };
type Editing = { mode: "new"; item: LibraryItem; date: string; time: string; caption: string } | { mode: "edit"; entry: Entry; date: string; time: string; caption: string };

const C = { bg: "#FBF6EE", card: "#FFFFFF", ink: "#1E2620", muted: "#59645C", green: "#2E5B3E", tint: "#F1F6F2", line: "#EDE4D6", peach: "#FCE3CF", peachInk: "#7A3A10", orange: "#C26A2C" };
const STATUS: Record<PostStatus, { label: string; bg: string; ink: string }> = {
  posted: { label: "Posted ✓", bg: "#E6EDE7", ink: C.green },
  posting: { label: "Posting now", bg: "#E6EDE7", ink: C.green },
  failed: { label: "Failed", bg: "#F8D4D0", ink: "#8A1F14" },
  "on-server": { label: "On the server", bg: "#EDEBFA", ink: "#3D3A8C" },
  "not-sent": { label: "Not sent yet", bg: C.peach, ink: C.peachInk },
};

// Dates are plain "2026-10-27" strings in the queue's time zone; arithmetic is done at noon UTC to stay on the day
const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monday = (date: string): string => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const dayName = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
const longDate = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const clock = (time: string): string => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const fetchData = async (): Promise<Data> => (await fetch("/api/local", { cache: "no-store" })).json() as Promise<Data>;
const fromRenders = (path: string) => `/api/local/file?path=${encodeURIComponent(path)}`;
const hashtags = (caption: string) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

function postThumb(post: Post): string {
  if (post.kind === "carousel") return `/${post.images[0]}`;
  return post.cover ? `/${post.cover}` : "";
}
function itemThumb(item: LibraryItem): string {
  if (item.kind === "carousel") return fromRenders(item.files[0] ?? "");
  return item.cover ? fromRenders(item.cover) : "";
}

const button = (bg: string, ink: string) => ({ padding: "9px 16px", borderRadius: 999, border: "none", background: bg, color: ink, fontWeight: 700, fontSize: 14, cursor: "pointer" }) as const;
const panel = { background: C.card, borderRadius: 18, padding: 16 } as const;

export function Scheduler() {
  const [data, setData] = useState<Data | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const apply = useCallback((next: Data) => {
    setData(next);
    setWeek((current) => current ?? monday(next.now.date));
  }, []);
  const load = async () => apply(await fetchData());

  useEffect(() => {
    // Load once on open; every change reloads explicitly
    let live = true;
    void fetchData().then((next) => live && apply(next));
    return () => {
      live = false;
    };
  }, [apply]);

  const act = async (body: object, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const answer = await fetch("/api/local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await answer.json()) as { ok: boolean; message?: string };
      if (!result.ok) throw new Error(result.message ?? "Something went wrong");
      setMessage({ text: result.message ?? done ?? "Saved on this computer.", bad: false });
      await load();
      return true;
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Something went wrong", bad: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const days = useMemo(() => (week ? Array.from({ length: 7 }, (_, i) => addDays(week, i)) : []), [week]);
  if (!data || !week) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</p>;

  const usedBy = (key: string) => data.posts.filter((entry) => entry.post.source === key);
  const startNew = (item: LibraryItem, date: string) => setEditing({ mode: "new", item, date, time: "10:00", caption: item.caption });
  const startEdit = (entry: Entry) => setEditing({ mode: "edit", entry, date: entry.post.date, time: entry.post.time, caption: entry.post.caption });

  const save = async () => {
    if (!editing) return;
    const fields = { date: editing.date, time: editing.time, caption: editing.caption };
    const ok = editing.mode === "new" ? await act({ action: "create", source: editing.item.key, fields }, "Scheduled on this computer. Send when you're ready.") : await act({ action: "update", id: editing.entry.post.id, fields });
    if (ok) setEditing(null);
  };

  const locked = editing?.mode === "edit" && editing.entry.locked;
  const caption = editing?.caption ?? "";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 14 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 24px", background: C.card, borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: C.green }} />
          <b style={{ font: "600 20px Georgia, serif" }}>Post scheduler</b>
          <span style={{ color: C.muted }}>
            · on your computer · {data.timeZone.replace("_", " ")} time
            {data.server ? "" : " · not connected to the server, so posted/failed can't be shown"}
            {data.github ? "" : " · couldn't reach GitHub"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data.changes > 0 ? <b style={{ color: C.peachInk }}>{data.changes === 1 ? "1 change" : `${data.changes} changes`} not sent yet</b> : <span style={{ color: C.muted }}>Everything is sent</span>}
          <button type="button" disabled={busy || data.changes === 0} onClick={() => void act({ action: "send" })} style={{ ...button(C.green, "#fff"), opacity: busy || data.changes === 0 ? 0.5 : 1 }}>
            Send to server ↑
          </button>
        </div>
      </header>

      {message ? <p style={{ margin: "12px 24px 0", padding: "10px 14px", borderRadius: 12, whiteSpace: "pre-line", background: message.bad ? "#F8D4D0" : C.tint, color: message.bad ? "#8A1F14" : C.green }}>{message.text}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "250px minmax(0, 1fr) 340px", gap: 18, padding: "18px 24px" }}>
        {/* Ready to post: everything in renders/ */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>Ready to post</h2>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>From renders/. Drag onto a day, or click to schedule.</p>
          {data.library.map((item) => {
            const used = usedBy(item.key);
            const note = used.some((entry) => entry.status === "posted") ? "posted" : used.length > 0 ? "scheduled" : "never posted";
            return (
              <button
                key={item.key}
                type="button"
                draggable={item.problems.length === 0}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", item.key)}
                onClick={() => startNew(item, data.now.date >= week && data.now.date <= addDays(week, 6) ? data.now.date : week)}
                style={{ display: "flex", gap: 10, alignItems: "center", textAlign: "left", background: C.card, border: "none", borderRadius: 14, padding: 8, cursor: "grab" }}
              >
                {itemThumb(item) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview straight from renders/
                  <img src={itemThumb(item)} alt="" style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 8 }} />
                ) : (
                  <span style={{ width: 44, height: 58, borderRadius: 8, background: C.ink }} />
                )}
                <span>
                  <b style={{ display: "block", fontSize: 13 }}>{item.title}</b>
                  <span style={{ fontSize: 12, color: item.problems.length ? "#8A1F14" : C.muted }}>
                    {item.problems.length ? item.problems[0] : `${item.kind === "reel" ? "Reel" : `Carousel · ${item.files.length} ${item.files.length === 1 ? "photo" : "slides"}`} · ${note}`}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        {/* The week */}
        <section style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>Week of {longDate(week)}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setWeek(addDays(week, -7))} style={button(C.tint, C.green)}>
                ← Last week
              </button>
              <button type="button" onClick={() => setWeek(monday(data.now.date))} style={button(C.tint, C.green)}>
                This week
              </button>
              <button type="button" onClick={() => setWeek(addDays(week, 7))} style={button(C.tint, C.green)}>
                Next week →
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
            {days.map((day) => {
              const entries = data.posts.filter((entry) => entry.post.date === day);
              const past = day < data.now.date;
              return (
                <div
                  key={day}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const item = data.library.find((entry) => entry.key === event.dataTransfer.getData("text/plain"));
                    if (item) startNew(item, day);
                  }}
                  style={{ minHeight: 440, borderRadius: 12, background: C.bg, padding: 8, display: "flex", flexDirection: "column", gap: 8, outline: day === data.now.date ? `2px solid ${C.green}` : "none", opacity: past ? 0.75 : 1 }}
                >
                  <b style={{ fontSize: 13 }}>
                    {dayName(day)}
                    {day === data.now.date ? " · today" : ""}
                  </b>
                  {entries.map((entry) => {
                    const look = STATUS[entry.status];
                    const selected = editing?.mode === "edit" && editing.entry.post.id === entry.post.id;
                    return (
                      <button key={entry.post.id} type="button" onClick={() => startEdit(entry)} style={{ display: "flex", flexDirection: "column", gap: 5, textAlign: "left", background: C.card, border: "none", borderRadius: 10, padding: 6, cursor: "pointer", outline: selected ? `3px solid ${C.orange}` : "none" }}>
                        {postThumb(entry.post) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- the scheduled media itself
                          <img src={postThumb(entry.post)} alt="" style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 7 }} />
                        ) : null}
                        <b style={{ fontSize: 12 }}>
                          {clock(entry.post.time)} · {data.library.find((item) => item.key === entry.post.source)?.title ?? entry.post.id}
                        </b>
                        <span style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: look.bg, color: look.ink }}>{look.label}</span>
                        {entry.soon && !entry.locked ? <span style={{ fontSize: 11, color: C.peachInk }}>Posting soon</span> : null}
                      </button>
                    );
                  })}
                  {past ? null : (
                    <span style={{ border: `1.5px dashed #B9C4BB`, borderRadius: 10, padding: 8, textAlign: "center", color: C.muted, fontSize: 12 }}>Drop here</span>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: C.muted }}>
            <b>Not sent yet</b>: only on this computer · <b>On the server</b>: will post at its time (within about an hour) · <b>Posted ✓</b> · <b>Failed</b>: tried again each hour, up to two days late.
          </p>
        </section>

        {/* The post */}
        <aside style={{ ...panel, display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}>
          {editing ? (
            <>
              <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>{editing.mode === "new" ? "Schedule post" : locked ? "Post" : "Edit post"}</h2>
              <Preview editing={editing} />
              {editing.mode === "edit" && editing.entry.error ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: "#F8D4D0", color: "#8A1F14", fontSize: 13 }}>Last try failed: {editing.entry.error}</p> : null}
              {editing.mode === "edit" && editing.entry.soon && !locked ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: C.peach, color: C.peachInk, fontSize: 13 }}>Posting soon: a change sent now may arrive after it has gone out.</p> : null}
              {locked ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: C.tint, color: C.green, fontSize: 13 }}>{editing.entry.status === "posted" ? "This has gone out. To change the caption, edit it in the Instagram app." : "Its time has passed, so it can't be changed here."}</p> : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
                  Date
                  <input type="date" value={editing.date} disabled={locked} min={data.now.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 10, border: `1.5px solid ${C.line}`, background: C.bg, font: "inherit", boxSizing: "border-box" }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
                  Time
                  <input type="time" value={editing.time} disabled={locked} onChange={(event) => setEditing({ ...editing, time: event.target.value })} style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 10, border: `1.5px solid ${C.line}`, background: C.bg, font: "inherit", boxSizing: "border-box" }} />
                </label>
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
                Caption
                <textarea value={caption} disabled={locked} rows={12} onChange={(event) => setEditing({ ...editing, caption: event.target.value })} style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10, border: `1.5px solid ${C.line}`, background: C.bg, font: "inherit", fontSize: 13, lineHeight: 1.45, color: C.ink, boxSizing: "border-box", resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginTop: -6 }}>
                <span style={{ color: caption.length > CAPTION_LIMIT ? "#8A1F14" : C.muted }}>
                  {caption.length.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()} characters
                </span>
                <span style={{ color: hashtags(caption) > HASHTAG_LIMIT ? "#8A1F14" : C.muted }}>
                  {hashtags(caption)} / {HASHTAG_LIMIT} hashtags
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {locked ? null : (
                  <button type="button" disabled={busy || caption.trim() === "" || caption.length > CAPTION_LIMIT} onClick={() => void save()} style={button(C.green, "#fff")}>
                    {editing.mode === "new" ? "Schedule" : "Save"}
                  </button>
                )}
                {editing.mode === "edit" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const item = data.library.find((entry) => entry.key === editing.entry.post.source);
                      if (item) setEditing({ mode: "new", item, date: addDays(editing.date < data.now.date ? data.now.date : editing.date, 1), time: editing.time, caption: editing.caption });
                      else setMessage({ text: "The original file isn't in renders/ any more, so it can't be duplicated.", bad: true });
                    }}
                    style={button(C.tint, C.green)}
                  >
                    Duplicate
                  </button>
                ) : null}
                {editing.mode === "edit" && !locked ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove this post? If it was sent, it's cancelled when you next send.")) void act({ action: "remove", id: editing.entry.post.id }, "Removed. Send to cancel it on the server too.").then((ok) => ok && setEditing(null));
                    }}
                    style={button(C.peach, C.peachInk)}
                  >
                    Remove
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(null)} style={button("transparent", C.muted)}>
                  Close
                </button>
              </div>
              <p style={{ margin: 0, padding: 10, borderRadius: 12, border: "1.5px dashed #B9C4BB", fontSize: 12, color: C.muted, lineHeight: 1.45 }}>After a Reel posts, add the “AI info” label in Instagram (the voices are ElevenLabs).</p>
            </>
          ) : (
            <>
              <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>Post</h2>
              <p style={{ margin: 0, color: C.muted, lineHeight: 1.5 }}>Click a post in the week to edit it, or drag something from Ready to post onto a day.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Preview({ editing }: { editing: Editing }) {
  const media = editing.mode === "new" ? { kind: editing.item.kind, files: editing.item.files.map(fromRenders), cover: editing.item.cover ? fromRenders(editing.item.cover) : undefined } : editing.entry.post.kind === "reel" ? { kind: "reel" as const, files: [`/${editing.entry.post.video}`], cover: editing.entry.post.cover ? `/${editing.entry.post.cover}` : undefined } : { kind: "carousel" as const, files: editing.entry.post.images.map((path) => `/${path}`), cover: undefined };
  const title = editing.mode === "new" ? editing.item.title : editing.entry.post.id;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <b>{title}</b>
      {media.kind === "reel" ? (
        <video key={media.files[0]} controls preload="metadata" poster={media.cover} style={{ width: 160, aspectRatio: "9 / 16", borderRadius: 12, background: C.ink, objectFit: "cover" }}>
          <source src={media.files[0]} type="video/mp4" />
        </video>
      ) : (
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {media.files.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- the exact slides that will post
            <img key={src} src={src} alt={`Slide ${i + 1}`} style={{ width: 120, aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
          ))}
        </div>
      )}
      <span style={{ fontSize: 12, color: C.muted }}>{media.kind === "reel" ? "Reel" : `Carousel · ${media.files.length} slides`}</span>
    </div>
  );
}
