// GET /api/status: what has gone out and the last error, for the scheduler on your computer.
// Needs the same "Authorization: Bearer <CRON_SECRET>" as the publisher; shows ids and times only, never the token.
import { loadState } from "@/lib/store";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ ok: false, message: "No Blob store is connected to the project" }, { status: 503 });
  const { state } = await loadState();
  return Response.json({ ok: true, published: state.published, lastError: state.lastError ?? null, posting: state.claim?.postId ?? null });
}
