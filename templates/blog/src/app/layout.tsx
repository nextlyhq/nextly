import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

/**
 * The faces come from packages in `node_modules` rather than from
 * `next/font/google`, which fetches them from fonts.googleapis.com at BUILD
 * time — so a build behind a proxy, on a locked-down CI runner, or simply
 * offline fails at a step that has nothing to do with the app's code.
 *
 * `next/font/local` rather than the packages' own stylesheets, so the faces
 * keep the CSS variables the styles already reference, and keep the
 * metric-adjusted fallback that stops text reflowing once the face arrives.
 */
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
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
 * `metadataBase` tells Next.js how to resolve relative URLs in
 * OpenGraph images, Twitter images, and canonical URLs. Set
 * `NEXT_PUBLIC_SITE_URL` in your environment to your production
 * domain (e.g. `https://yourblog.com`). The localhost fallback keeps
 * dev working.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: { default: "Nextly", template: "%s — Nextly" },
  description: "A blog built with Nextly.",
};

/**
 * Inline theme-init script.
 *
 * Runs before React hydrates so the correct theme class is set on
 * <html> on first paint - eliminates flash-of-wrong-theme. Reads the
 * user preference from localStorage under `nextly-theme`; falls back
 * to `prefers-color-scheme: dark` when preference is "system" or
 * unset. See `src/components/ThemeToggle.tsx` for the writer side.
 */
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem("nextly-theme");
    var pref = stored || "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = pref === "dark" || (pref === "system" && prefersDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/*
        suppressHydrationWarning on <body> because some browser extensions
        (ColorZilla, Honey, Grammarly, etc.) inject attributes like
        `cz-shortcut-listen="true"` after page load, causing harmless
        hydration warnings. We keep the warning suppressed only on this
        element; React still flags hydration mismatches in the rest of
        the tree.
      */}
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
