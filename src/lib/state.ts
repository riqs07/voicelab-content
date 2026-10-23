// What the publisher remembers between runs: which posts went out, the latest token, and the last error.
// Stored as one private JSON file in Vercel Blob (see store.ts); this part is plain logic.

export type State = {
  // Post id → Instagram's id and when it went out
  published: Record<string, { mediaId: string; at: string }>;
  // The refreshed token, once there is one (the first comes from INSTAGRAM_ACCESS_TOKEN)
  token?: { value: string; refreshedAt: string };
  lastError?: { postId: string; message: string; at: string };
  // Set just before publishing, so a second run at the same moment backs off instead of posting twice
  claim?: { postId: string; at: string };
};

// A claim older than this is from a run that died part way; it no longer blocks
const CLAIM_MS = 15 * 60 * 1000;

export function claimedByAnotherRun(state: State, now: Date): boolean {
  return state.claim !== undefined && now.getTime() - Date.parse(state.claim.at) < CLAIM_MS;
}

// Refresh about weekly, well inside the 60-day life
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export function needsRefresh(state: State, now: Date): boolean {
  if (!state.token) return true;
  return now.getTime() - Date.parse(state.token.refreshedAt) > REFRESH_EVERY_MS;
}

// Read the stored JSON. No file yet means a first run. A damaged file stops the run instead of
// starting from empty, because empty would mean "nothing has been posted" and posts could go out twice.
export function parseState(text: string | null): State {
  if (text === null) return { published: {} };
  const raw = JSON.parse(text) as Partial<State> | null;
  if (!raw || typeof raw !== "object" || !raw.published || typeof raw.published !== "object") throw new Error("The publisher's saved state is damaged; fix or delete social/state.json in Blob");
  return { published: raw.published, token: raw.token, lastError: raw.lastError, claim: raw.claim };
}
