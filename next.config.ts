// Next.js settings for the Instagram publisher
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Extra React checks during development
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Stop browsers guessing file types
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Stop other sites framing the pages
          { key: "X-Frame-Options", value: "DENY" },
          // Keep the pages out of search results; the media is only here for Instagram to fetch
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
