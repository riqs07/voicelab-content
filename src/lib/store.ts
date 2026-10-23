// Saving the publisher's state as one private file in Vercel Blob (needs BLOB_READ_WRITE_TOKEN,
// which Vercel adds when a Blob store is connected to the project).
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { parseState, type State } from "./state";

const PATH = "social/state.json";

export async function loadState(): Promise<{ state: State; etag: string | null }> {
  const found = await get(PATH, { access: "private", useCache: false });
  if (!found || found.statusCode !== 200) return { state: parseState(null), etag: null };
  const text = await new Response(found.stream).text();
  return { state: parseState(text), etag: found.blob.etag };
}

// Save, but only if nobody else saved since we read (etag). Returns the new etag, or null if someone did.
export async function saveState(state: State, etag: string | null): Promise<string | null> {
  try {
    const saved = await put(PATH, JSON.stringify(state, null, 2), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : {}),
    });
    return saved.etag;
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) return null;
    throw error;
  }
}
