import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * The faces come from packages in `node_modules` rather than from
 * `next/font/google`, which fetches them from fonts.googleapis.com at BUILD
 * time — so a build behind a proxy, on a locked-down CI runner, or simply
 * offline fails at a step that has nothing to do with the app's code.
 *
 * `next/font/local` rather than the packages' own stylesheets, because the
 * variable NAMES below are load-bearing and a stylesheet fixes its own.
 *
 * Named `--font-geist` rather than `--font-geist-sans` because that is the
 * variable the admin theme reads. The face is exposed only through this
 * variable, so a name the theme does not know leaves the admin falling back to
 * the system sans while the app's own pages render in Geist.
 */
const geistSans = localFont({
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  variable: "--font-geist",
  display: "swap",
  // One file spanning the whole weight axis; the filename carries no weight
  // for Next to infer, so the range is declared.
  weight: "100 900",
});

const geistMono = localFont({
  src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
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
