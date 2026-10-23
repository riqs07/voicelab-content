// This app's public address, which Instagram downloads the media from: PUBLIC_URL if set,
// else the Vercel production address (yourproject.vercel.app), else local.
export function publicUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
