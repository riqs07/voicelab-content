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
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ full)) as ReadableStream;
  return new Response(stream, { headers: { "content-type": type, "content-length": String(statSync(/*turbopackIgnore: true*/ full).size) } });
}
