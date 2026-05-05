import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
