import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Named `--font-geist` rather than `--font-geist-sans` because that is the
 * variable the admin theme reads. `next/font` self-hosts the face and exposes it
 * only through this variable, so a name the theme does not know leaves the admin
 * falling back to the system sans while the app's own pages render in Geist.
 */
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * `metadataBase` tells Next.js how to resolve relative URLs in OpenGraph
 * images, Twitter images, and canonical URLs. Set `NEXT_PUBLIC_SITE_URL`
 * in your environment to your production domain (e.g.
 * `https://yourblog.com`). The localhost fallback keeps dev working.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: { default: "Nextly", template: "%s — Nextly" },
  description: "A site built with Nextly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables belong on <html>: the admin theme declares --font-sans
    // in a non-inline @theme, which emits it into :root and resolves the
    // reference THERE. A variable exposed lower down, on <body>, is invisible to
    // that declaration however it is spelled.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
