// On your computer (pnpm dev): the scheduler. On a preview deployment: the queue, read-only.
// On production: nothing; the production deployment only serves media to Instagram and posts.
import queueFile from "@/data/queue.json";
import { Scheduler } from "./Scheduler";
import type { Post, Queue } from "@/lib/queue";

const queue = queueFile as Queue;

const card = { background: "#FFFFFF", borderRadius: 24, padding: 20, display: "flex", flexDirection: "column", gap: 12 } as const;
const tile = { width: 200, flexShrink: 0, borderRadius: 16, objectFit: "cover", background: "#1E2620" } as const;

function nice(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function Media({ post }: { post: Post }) {
  if (post.kind === "reel")
    return (
      <video controls preload="metadata" poster={post.cover ? `/${post.cover}` : undefined} style={{ ...tile, aspectRatio: "9 / 16" }}>
        <source src={`/${post.video}`} type="video/mp4" />
      </video>
    );
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
      {post.images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- the exact file Instagram gets
        <img key={src} src={`/${src}`} alt={`Slide ${i + 1}`} style={{ ...tile, aspectRatio: "4 / 5" }} />
      ))}
    </div>
  );
}

export default function QueuePage() {
  if (process.env.NODE_ENV === "development" && !process.env.VERCEL) return <Scheduler />;
  if (process.env.VERCEL_ENV === "production") return <p style={{ padding: 24 }}>Nothing to see here.</p>;
  const posts = [...queue.posts].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ margin: 0, fontSize: 40 }}>Post queue</h1>
      <p style={{ margin: 0, fontSize: 18, color: "#59645C", lineHeight: 1.5 }}>
        These go to Instagram at their time, within about an hour ({queue.timeZone.replace("_", " ")} time). Plan and change them with the scheduler on your computer.
      </p>
      {posts.map((post) => (
        <section key={post.id} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 24 }}>
              {nice(post.date)} · {post.time}
            </h2>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#59645C" }}>{post.kind === "reel" ? "Reel" : `Carousel · ${post.images.length} slides`}</span>
          </div>
          <Media post={post} />
          <p style={{ margin: 0, whiteSpace: "pre-line", lineHeight: 1.5 }}>{post.caption}</p>
        </section>
      ))}
    </main>
  );
}
