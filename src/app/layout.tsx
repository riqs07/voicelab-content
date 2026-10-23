import type { Metadata } from "next";

export const metadata: Metadata = { title: "VoiceLab post queue", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#FBF6EE", color: "#1E2620", fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
