"use client";
// The post scheduler you run on your computer. The main screen is for scheduling: what's in renders/ (Ready,
// Scheduled, Posted), the post panel, and Up next. The calendar opens as its own window on top.
// Everything it changes is saved on this computer until "Send to server".
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "@/lib/library";
import { CAPTION_LIMIT, HASHTAG_LIMIT, type Post } from "@/lib/queue";
import type { PostStatus } from "@/lib/status";

type Entry = { post: Post; status: PostStatus; locked: boolean; soon: boolean; error: string | null };
type Data = { timeZone: string; now: { date: string; time: string }; posts: Entry[]; library: LibraryItem[]; changes: number; moved: string[]; github: boolean; server: boolean };
type Cover = { kind: "default" } | { kind: "image"; path: string } | { kind: "frame"; seconds: number };
type Draft = { date: string; time: string; caption: string; as: "reel" | "story"; cover: Cover; coverChanged: boolean };
type Editing = ({ mode: "new"; item: LibraryItem } | { mode: "edit"; entry: Entry; item: LibraryItem | undefined }) & Draft;
type Tab = "ready" | "scheduled" | "posted";

const C = { bg: "#FBF6EE", card: "#FFFFFF", ink: "#1E2620", muted: "#59645C", green: "#2E5B3E", tint: "#F1F6F2", line: "#EDE4D6", peach: "#FCE3CF", peachInk: "#7A3A10", orange: "#C26A2C", red: "#8A1F14", redBg: "#F8D4D0" };
const STATUS: Record<PostStatus, { label: string; bg: string; ink: string }> = {
  posted: { label: "Posted ✓", bg: "#E6EDE7", ink: C.green },
  posting: { label: "Posting now", bg: "#E6EDE7", ink: C.green },
  failed: { label: "Failed", bg: C.redBg, ink: C.red },
  "on-server": { label: "On the server", bg: "#EDEBFA", ink: "#3D3A8C" },
  "not-sent": { label: "Not sent yet", bg: C.peach, ink: C.peachInk },
};
const DEFAULT_TIME = "10:00";

// Dates are plain "2026-10-27" strings in the queue's time zone; arithmetic is done at noon UTC to stay on the day
const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string): number => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const monday = (date: string): string => addDays(date, -weekday(date));
const longDate = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthDay = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const clock = (time: string): string => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const seconds = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fromRenders = (path: string) => `/api/local/file?path=${encodeURIComponent(path)}`;
const hashtags = (caption: string) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
// "Who is VoiceLab for? (Overview)" → "Who is VoiceLab for?", to keep lists readable
const short = (title: string): string => title.replace(/\s*\([^)]*\)\s*$/, "");
const fetchData = async (): Promise<Data> => (await fetch("/api/local", { cache: "no-store" })).json() as Promise<Data>;

const button = (bg: string, ink: string) => ({ padding: "9px 16px", borderRadius: 999, border: "none", background: bg, color: ink, fontWeight: 700, fontSize: 14, cursor: "pointer" }) as const;
const panel = { background: C.card, borderRadius: 18, padding: 16 } as const;
const fieldStyle = { display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 10, border: `1.5px solid ${C.line}`, background: C.bg, font: "inherit", color: C.ink, boxSizing: "border-box" } as const;
const labelStyle = { fontSize: 12, fontWeight: 700, color: C.muted } as const;
const chip = (status: PostStatus) => ({ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: STATUS[status].bg, color: STATUS[status].ink }) as const;

function itemThumb(item: LibraryItem | undefined): string {
  if (!item) return "";
  if (item.kind === "carousel") return fromRenders(item.files[0] ?? "");
  return item.cover ? fromRenders(item.cover) : "";
}
function postThumb(post: Post, item: LibraryItem | undefined): string {
  if (post.kind === "carousel") return `/${post.images[0]}`;
  if (post.cover) return `/${post.cover}`;
  return itemThumb(item);
}
// What the editor shows for a post's current cover
function coverOf(post: Post, item: LibraryItem | undefined): Cover {
  if (post.kind !== "reel") return { kind: "default" };
  if (post.coverFrame !== undefined) return { kind: "frame", seconds: post.coverFrame };
  if (post.coverSource && post.coverSource !== item?.cover) return { kind: "image", path: post.coverSource };
  return { kind: "default" };
}

export function Scheduler() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("ready");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const apply = useCallback((next: Data) => {
    setData(next);
    if (next.moved.length > 0) setMessage({ text: `Posted, so moved to renders/posted/: ${next.moved.join(", ")}. They go up with your next Send.`, bad: false });
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

  const act = async (body: object, done?: string): Promise<boolean> => {
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

  const itemFor = useCallback((key: string) => data?.library.find((item) => item.key === key && !item.posted) ?? data?.library.find((item) => item.key === key), [data]);
  const upcoming = useMemo(() => (data ? data.posts.filter((entry) => entry.status !== "posted").sort((a, b) => `${a.post.date} ${a.post.time}`.localeCompare(`${b.post.date} ${b.post.time}`)) : []), [data]);
  if (!data) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</p>;

  // The first day from today (tomorrow if 10am has passed) with nothing waiting to post
  const nextFreeDay = (): string => {
    let day = data.now.time < DEFAULT_TIME ? data.now.date : addDays(data.now.date, 1);
    while (upcoming.some((entry) => entry.post.date === day)) day = addDays(day, 1);
    return day;
  };
  const startNew = (item: LibraryItem, date = nextFreeDay()) => setEditing({ mode: "new", item, date, time: DEFAULT_TIME, caption: item.caption, as: "reel", cover: { kind: "default" }, coverChanged: false });
  const startEdit = (entry: Entry) => {
    const item = itemFor(entry.post.source);
    setEditing({ mode: "edit", entry, item, date: entry.post.date, time: entry.post.time, caption: entry.post.caption, as: entry.post.kind === "reel" && entry.post.as === "story" ? "story" : "reel", cover: coverOf(entry.post, item), coverChanged: false });
  };
  const fields = (draft: Draft) => ({ date: draft.date, time: draft.time, caption: draft.caption, as: draft.as });
  const save = async () => {
    if (!editing) return;
    const ok =
      editing.mode === "new"
        ? await act({ action: "create", source: editing.item.key, fields: fields(editing), cover: editing.cover }, "Scheduled on this computer. Send when you're ready.")
        : await act({ action: "update", id: editing.entry.post.id, fields: fields(editing), cover: editing.coverChanged ? editing.cover : null });
    if (ok) setEditing(null);
  };
  // Calendar drag: same post, new day, same time
  const moveTo = (entry: Entry, date: string) => {
    if (entry.locked || date === entry.post.date) return;
    void act({ action: "update", id: entry.post.id, fields: { date, time: entry.post.time, caption: entry.post.caption, as: entry.post.kind === "reel" && entry.post.as === "story" ? "story" : "reel" }, cover: null }, `Moved to ${longDate(date)}. Send when you're ready.`);
  };

  const ready = data.library.filter((item) => !item.posted);
  const posted = data.library.filter((item) => item.posted);
  const sameDay = editing ? upcoming.filter((entry) => entry.post.date === editing.date && (editing.mode === "new" || entry.post.id !== editing.entry.post.id)).length : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 14 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 24px", background: C.card, borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: C.green }} />
          <b style={{ font: "600 20px Georgia, serif" }}>Post scheduler</b>
          <span style={{ color: C.muted }}>
            · {data.timeZone.replace("_", " ")} time · {data.server ? "connected" : "not connected to the server (see social/README), so Posted can't be shown"}
            {data.github ? "" : " · couldn't reach GitHub"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={() => setCalendar(true)} style={button(C.tint, C.green)}>
            Calendar
          </button>
          {data.changes > 0 ? <b style={{ color: C.peachInk }}>{data.changes === 1 ? "1 change" : `${data.changes} changes`} not sent</b> : <span style={{ color: C.muted }}>Everything is sent</span>}
          <button type="button" disabled={busy || data.changes === 0} onClick={() => void act({ action: "send" })} style={{ ...button(C.green, "#fff"), opacity: busy || data.changes === 0 ? 0.5 : 1 }}>
            Send to server ↑
          </button>
        </div>
      </header>

      {message ? <p style={{ margin: "12px 24px 0", padding: "10px 14px", borderRadius: 12, whiteSpace: "pre-line", background: message.bad ? C.redBg : C.tint, color: message.bad ? C.red : C.green }}>{message.text}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 18, padding: "18px 24px" }}>
        <main>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, font: "600 20px Georgia, serif" }}>{tab === "ready" ? "Ready to post" : tab === "scheduled" ? "Scheduled" : "Posted"}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              {(
                [
                  ["ready", `Ready · ${ready.length}`],
                  ["scheduled", `Scheduled · ${upcoming.length}`],
                  ["posted", `Posted · ${posted.length}`],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setTab(key)} style={button(tab === key ? C.ink : C.card, tab === key ? "#fff" : C.muted)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: C.muted }}>
            {tab === "ready"
              ? "Everything in renders/. Click one to schedule it. Once it has posted, its files move to renders/posted/."
              : tab === "scheduled"
                ? "Everything waiting to post, soonest first. Click one to change it."
                : "Already on Instagram. These files are in renders/posted/."}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14, marginTop: 14 }}>
            {tab === "ready"
              ? ready.map((item) => {
                  const next = upcoming.find((entry) => entry.post.source === item.key);
                  const selected = editing?.mode === "new" && editing.item.key === item.key;
                  return (
                    <Card key={item.key} thumb={itemThumb(item)} title={short(item.title)} detail={item.problems[0] ?? (item.kind === "reel" ? "Reel · 9:16" : `Carousel · ${item.files.length} ${item.files.length === 1 ? "photo" : "slides"}`)} bad={item.problems.length > 0} selected={selected} onClick={() => startNew(item)}>
                      {next ? <span style={chip("on-server")}>Scheduled {longDate(next.post.date)} {clock(next.post.time)}</span> : <span style={{ ...chip("posted"), background: C.tint }}>Ready</span>}
                    </Card>
                  );
                })
              : tab === "scheduled"
                ? upcoming.map((entry) => {
                    const item = itemFor(entry.post.source);
                    const selected = editing?.mode === "edit" && editing.entry.post.id === entry.post.id;
                    return (
                      <Card key={entry.post.id} thumb={postThumb(entry.post, item)} title={short(item?.title ?? entry.post.id)} detail={`${longDate(entry.post.date)} · ${clock(entry.post.time)}${entry.post.kind === "reel" && entry.post.as === "story" ? " · Story" : ""}`} selected={selected} onClick={() => startEdit(entry)}>
                        <span style={chip(entry.status)}>{STATUS[entry.status].label}</span>
                      </Card>
                    );
                  })
                : posted.map((item) => {
                    const when = data.posts.filter((entry) => entry.post.source === item.key && entry.status === "posted").map((entry) => longDate(entry.post.date));
                    return (
                      <Card key={`posted-${item.key}`} thumb={itemThumb(item)} title={short(item.title)} detail={when.length ? `Posted ${when.join(", ")}` : "Posted"}>
                        <span style={chip("posted")}>Posted ✓</span>
                      </Card>
                    );
                  })}
          </div>
          {tab === "posted" && posted.length === 0 ? <p style={{ color: C.muted }}>Nothing has posted yet.</p> : null}
          {tab === "scheduled" && upcoming.length === 0 ? <p style={{ color: C.muted }}>Nothing is scheduled. Pick something from Ready.</p> : null}
        </main>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {editing ? (
            <PostPanel
              editing={editing}
              title={short(editing.item?.title ?? (editing.mode === "edit" ? editing.entry.post.id : ""))}
              sameDay={sameDay}
              busy={busy}
              minDate={data.now.date}
              onChange={setEditing}
              onSave={() => void save()}
              onClose={() => setEditing(null)}
              onDuplicate={() => {
                if (editing.mode !== "edit") return;
                const item = itemFor(editing.entry.post.source);
                if (item && !item.posted) setEditing({ ...editing, mode: "new", item, date: nextFreeDay(), coverChanged: true });
                else setMessage({ text: "That item has moved to renders/posted/, so it can't be scheduled again from here.", bad: true });
              }}
              onRemove={() => {
                if (editing.mode !== "edit") return;
                if (window.confirm("Remove this post? If it was sent, it's cancelled when you next send.")) void act({ action: "remove", id: editing.entry.post.id }, "Removed. Send to cancel it on the server too.").then((ok) => ok && setEditing(null));
              }}
            />
          ) : (
            <section style={{ ...panel, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>Schedule a post</h2>
              <p style={{ margin: 0, color: C.muted, lineHeight: 1.5 }}>Click something under Ready to post. It suggests the next free day; change anything before you press Schedule.</p>
            </section>
          )}

          <section style={{ ...panel, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, font: "600 17px Georgia, serif" }}>Up next</h2>
              <button type="button" onClick={() => setCalendar(true)} style={{ ...button("transparent", C.green), padding: 0 }}>
                Open calendar →
              </button>
            </div>
            {upcoming.length === 0 ? <p style={{ margin: 0, color: C.muted }}>Nothing scheduled yet.</p> : null}
            {upcoming.slice(0, 5).map((entry) => {
              const item = itemFor(entry.post.source);
              const thumb = postThumb(entry.post, item);
              return (
                <button key={entry.post.id} type="button" onClick={() => startEdit(entry)} style={{ display: "flex", gap: 10, alignItems: "center", padding: 6, borderRadius: 12, border: "none", background: C.bg, textAlign: "left", cursor: "pointer" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                  {thumb ? <img src={thumb} alt="" style={{ width: 36, height: 46, objectFit: "cover", borderRadius: 6 }} /> : <span style={{ width: 36, height: 46, borderRadius: 6, background: C.ink }} />}
                  <span>
                    <b style={{ display: "block", fontSize: 13 }}>{short(item?.title ?? entry.post.id)}</b>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {longDate(entry.post.date)} · {clock(entry.post.time)} · <span style={{ color: STATUS[entry.status].ink }}>{STATUS[entry.status].label}</span>
                    </span>
                  </span>
                </button>
              );
            })}
            {upcoming.length > 5 ? <span style={{ fontSize: 12, color: C.muted }}>and {upcoming.length - 5} more in the calendar</span> : null}
          </section>
        </aside>
      </div>

      {calendar ? (
        <Calendar
          data={data}
          itemFor={itemFor}
          onClose={() => setCalendar(false)}
          onOpen={(entry) => {
            startEdit(entry);
            setCalendar(false);
          }}
          onMove={moveTo}
        />
      ) : null}
    </div>
  );
}

function Card({ thumb, title, detail, bad, selected, onClick, children }: { thumb: string; title: string; detail: string; bad?: boolean; selected?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", background: C.card, border: "none", borderRadius: 16, padding: 8, cursor: onClick ? "pointer" : "default", outline: selected ? `3px solid ${C.orange}` : "none", color: C.ink }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview straight from renders/ */}
      {thumb ? <img src={thumb} alt="" style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 10 }} /> : <span style={{ width: "100%", aspectRatio: "4 / 5", borderRadius: 10, background: C.ink }} />}
      <b style={{ fontSize: 13 }}>{title}</b>
      <span style={{ fontSize: 12, color: bad ? C.red : C.muted }}>{detail}</span>
      {children}
    </button>
  );
}

function PostPanel({
  editing,
  title,
  sameDay,
  busy,
  minDate,
  onChange,
  onSave,
  onClose,
  onDuplicate,
  onRemove,
}: {
  editing: Editing;
  title: string;
  sameDay: number;
  busy: boolean;
  minDate: string;
  onChange: (next: Editing) => void;
  onSave: () => void;
  onClose: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [pickingFrame, setPickingFrame] = useState(false);
  const [frameAt, setFrameAt] = useState(0);
  const entry = editing.mode === "edit" ? editing.entry : null;
  const locked = entry?.locked ?? false;
  const isReel = editing.mode === "new" ? editing.item.kind === "reel" : editing.entry.post.kind === "reel";
  const story = isReel && editing.as === "story";
  // The video and images to show: renders/ files for a new post, the copied media for a scheduled one
  const video = editing.mode === "new" ? fromRenders(editing.item.files[0] ?? "") : editing.entry.post.kind === "reel" ? `/${editing.entry.post.video}` : "";
  const slides = editing.mode === "new" ? editing.item.files.map(fromRenders) : editing.entry.post.kind === "carousel" ? editing.entry.post.images.map((path) => `/${path}`) : [];
  const item = editing.item;
  const options = item ? [...new Set([...(item.cover ? [item.cover] : []), ...item.coverOptions])] : [];
  const setCover = (cover: Cover) => onChange({ ...editing, cover, coverChanged: true });
  const coverLabel = editing.cover.kind === "frame" ? `A frame at ${seconds(editing.cover.seconds)} of the video` : editing.cover.kind === "image" ? editing.cover.path : item?.cover ? `${item.cover} (its own cover)` : "None: Instagram picks a frame";
  const caption = editing.caption;

  return (
    <section style={{ ...panel, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, font: "600 18px Georgia, serif" }}>
        {editing.mode === "new" ? "Schedule" : locked ? "Post" : "Edit"}: {title}
      </h2>
      {entry?.error ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: C.redBg, color: C.red, fontSize: 13 }}>Last try failed: {entry.error}</p> : null}
      {entry?.soon && !locked ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: C.peach, color: C.peachInk, fontSize: 13 }}>Posting soon: a change sent now may arrive after it has gone out.</p> : null}
      {locked ? <p style={{ margin: 0, padding: 10, borderRadius: 10, background: C.tint, color: C.green, fontSize: 13 }}>{entry?.status === "posted" ? "This has gone out. To change the caption, edit it in the Instagram app." : "Its time has passed, so it can't be changed here."}</p> : null}

      {isReel ? (
        <div style={{ display: "flex", gap: 6 }}>
          {(["reel", "story"] as const).map((as) => (
            <button key={as} type="button" disabled={locked} onClick={() => onChange({ ...editing, as })} style={button(editing.as === as ? C.ink : C.tint, editing.as === as ? "#fff" : C.green)}>
              {as === "reel" ? "Post as Reel" : "Post as Story"}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {slides.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- the exact slides that will post
            <img key={src} src={src} alt={`Slide ${i + 1}`} style={{ width: 96, aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
          ))}
        </div>
      )}
      {story ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>A Story shows full screen for 24 hours. It has no caption or cover.</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={labelStyle}>
          Date
          <input type="date" value={editing.date} disabled={locked} min={minDate} onChange={(event) => onChange({ ...editing, date: event.target.value })} style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Time
          <input type="time" value={editing.time} disabled={locked} onChange={(event) => onChange({ ...editing, time: event.target.value })} style={fieldStyle} />
        </label>
      </div>
      {locked ? null : <span style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>{sameDay === 0 ? "Nothing else that day" : `${sameDay} other ${sameDay === 1 ? "post" : "posts"} that day`}</span>}

      {isReel && !story ? (
        <div>
          <span style={labelStyle}>Cover</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
            {options.map((path) => {
              const on = (editing.cover.kind === "default" && path === item?.cover) || (editing.cover.kind === "image" && editing.cover.path === path);
              return (
                <button key={path} type="button" disabled={locked} onClick={() => setCover(path === item?.cover ? { kind: "default" } : { kind: "image", path })} style={{ padding: 0, border: "none", borderRadius: 10, outline: on ? `3px solid ${C.green}` : "none", background: "none", cursor: "pointer" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- cover choice */}
                  <img src={fromRenders(path)} alt="" style={{ width: 54, aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 8, display: "block" }} />
                </button>
              );
            })}
            {locked ? null : (
              <button type="button" onClick={() => setPickingFrame((open) => !open)} style={{ ...button(editing.cover.kind === "frame" ? C.ink : C.tint, editing.cover.kind === "frame" ? "#fff" : C.green), fontSize: 12 }}>
                {pickingFrame ? "Close frame picker" : "Pick a frame…"}
              </button>
            )}
          </div>
          <span style={{ display: "block", fontSize: 12, color: C.muted, marginTop: 4 }}>Using {coverLabel}</span>
        </div>
      ) : null}

      {isReel && (pickingFrame || story) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <video key={video} src={video} controls preload="metadata" onTimeUpdate={(event) => setFrameAt(event.currentTarget.currentTime)} onSeeked={(event) => setFrameAt(event.currentTarget.currentTime)} style={{ width: 180, aspectRatio: "9 / 16", borderRadius: 12, background: C.ink, objectFit: "cover" }} />
          {pickingFrame && !story ? (
            <button
              type="button"
              onClick={() => {
                setCover({ kind: "frame", seconds: Math.round(frameAt * 10) / 10 });
                setPickingFrame(false);
              }}
              style={{ ...button(C.green, "#fff"), alignSelf: "flex-start", fontSize: 12 }}
            >
              Use this frame ({seconds(frameAt)})
            </button>
          ) : null}
        </div>
      ) : null}

      {story ? null : (
        <>
          <label style={labelStyle}>
            Caption
            <textarea value={caption} disabled={locked} rows={9} onChange={(event) => onChange({ ...editing, caption: event.target.value })} style={{ ...fieldStyle, padding: 10, fontSize: 13, lineHeight: 1.45, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginTop: -6 }}>
            <span style={{ color: caption.length > CAPTION_LIMIT ? C.red : C.muted }}>
              {caption.length.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()} characters
            </span>
            <span style={{ color: hashtags(caption) > HASHTAG_LIMIT ? C.red : C.muted }}>
              {hashtags(caption)} / {HASHTAG_LIMIT} hashtags
            </span>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {locked ? null : (
          <button type="button" disabled={busy || (!story && (caption.trim() === "" || caption.length > CAPTION_LIMIT))} onClick={onSave} style={button(C.green, "#fff")}>
            {editing.mode === "new" ? "Schedule" : "Save"}
          </button>
        )}
        {editing.mode === "edit" ? (
          <button type="button" onClick={onDuplicate} style={button(C.tint, C.green)}>
            Duplicate
          </button>
        ) : null}
        {editing.mode === "edit" && !locked ? (
          <button type="button" disabled={busy} onClick={onRemove} style={button(C.peach, C.peachInk)}>
            Remove
          </button>
        ) : null}
        <button type="button" onClick={onClose} style={button("transparent", C.muted)}>
          Close
        </button>
      </div>
      {isReel ? <p style={{ margin: 0, padding: 10, borderRadius: 12, border: "1.5px dashed #B9C4BB", fontSize: 12, color: C.muted, lineHeight: 1.45 }}>After it posts, add the “AI info” label in Instagram (the voices are ElevenLabs).</p> : null}
    </section>
  );
}

const SPANS = { week: 7, "2 weeks": 14, month: 28 } as const;
type Span = keyof typeof SPANS;

function Calendar({ data, itemFor, onClose, onOpen, onMove }: { data: Data; itemFor: (key: string) => LibraryItem | undefined; onClose: () => void; onOpen: (entry: Entry) => void; onMove: (entry: Entry, date: string) => void }) {
  const [span, setSpan] = useState<Span>("month");
  const [start, setStart] = useState(() => monday(data.now.date));
  const days = Array.from({ length: SPANS[span] }, (_, i) => addDays(start, i));
  const last = days[days.length - 1] ?? start;

  useEffect(() => {
    // Escape closes the window
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Calendar" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,38,32,0.45)", padding: 28, overflow: "auto", zIndex: 10 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ background: C.bg, borderRadius: 22, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <h2 style={{ margin: 0, font: "600 22px Georgia, serif" }}>Calendar</h2>
            <span style={{ color: C.muted }}>
              {monthDay(start)} – {monthDay(last)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {(Object.keys(SPANS) as Span[]).map((key) => (
              <button key={key} type="button" onClick={() => setSpan(key)} style={button(span === key ? C.ink : C.card, span === key ? "#fff" : C.muted)}>
                {key === "week" ? "This week" : key === "2 weeks" ? "2 weeks" : "Month"}
              </button>
            ))}
            <button type="button" aria-label="Earlier" onClick={() => setStart(addDays(start, -SPANS[span]))} style={button(C.tint, C.green)}>
              ←
            </button>
            <button type="button" onClick={() => setStart(monday(data.now.date))} style={button(C.tint, C.green)}>
              Today
            </button>
            <button type="button" aria-label="Later" onClick={() => setStart(addDays(start, SPANS[span]))} style={button(C.tint, C.green)}>
              →
            </button>
            <button type="button" onClick={onClose} style={button(C.tint, C.green)}>
              ✕ Close
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, margin: "14px 0 6px", fontSize: 12, fontWeight: 700, color: C.muted, padding: "0 4px" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {days.map((day) => {
            const past = day < data.now.date;
            const entries = data.posts.filter((entry) => entry.post.date === day).sort((a, b) => a.post.time.localeCompare(b.post.time));
            return (
              <div
                key={day}
                onDragOver={(event) => !past && event.preventDefault()}
                onDrop={(event) => {
                  const entry = data.posts.find((candidate) => candidate.post.id === event.dataTransfer.getData("text/plain"));
                  if (entry && !past) onMove(entry, day);
                }}
                style={{ background: C.card, borderRadius: 10, minHeight: span === "month" ? 108 : 220, padding: 6, display: "flex", flexDirection: "column", gap: 4, outline: day === data.now.date ? `2px solid ${C.green}` : "none", opacity: past ? 0.6 : 1 }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {day.endsWith("-01") || day === start ? monthDay(day) : Number(day.slice(8))}
                  {day === data.now.date ? " · today" : ""}
                </span>
                {entries.map((entry) => {
                  const item = itemFor(entry.post.source);
                  const thumb = postThumb(entry.post, item);
                  return (
                    <button
                      key={entry.post.id}
                      type="button"
                      draggable={!entry.locked}
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", entry.post.id)}
                      onClick={() => onOpen(entry)}
                      title={`${STATUS[entry.status].label}${entry.locked ? " (locked)" : ""}`}
                      style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, padding: 3, borderRadius: 7, border: "none", background: STATUS[entry.status].bg, color: C.ink, textAlign: "left", cursor: "pointer" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                      {thumb ? <img src={thumb} alt="" style={{ width: 22, height: 28, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} /> : null}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {clock(entry.post.time).replace(" am", "a").replace(" pm", "p")} {short(item?.title ?? entry.post.id)}
                        {entry.status === "posted" ? " ✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, marginTop: 12, flexWrap: "wrap", color: C.muted }}>
          {(["posted", "on-server", "not-sent", "failed"] as const).map((status) => (
            <span key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, display: "inline-block", background: STATUS[status].bg }} />
              {STATUS[status].label}
            </span>
          ))}
          <span>Click a post to open it. Drag a post to another day to move it.</span>
        </div>
      </div>
    </div>
  );
}
