// Serves a file from renders/ so the scheduler can show it before it's scheduled. Local only.
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { inRenders, isLocal } from "@/lib/local/schedule";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime" };

export function GET(request: Request): Response {
  if (!isLocal()) return new Response("Not found", { status: 404 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  let full: string;
  try {
    full = inRenders(path);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!existsSync(/*turbopackIgnore: true*/ full)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  const size = statSync(/*turbopackIgnore: true*/ full).size;
  // Videos are asked for in pieces ("Range"); answering with just that piece is what lets the player jump
  // to any moment, which the cover frame picker needs
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const piece = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ full, { start, end })) as ReadableStream;
    return new Response(piece, { status: 206, headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" } });
  }
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ full)) as ReadableStream;
  return new Response(stream, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes" } });
}
