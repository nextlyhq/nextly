import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";

import "./globals.css";
import { SITE_URL } from "@/lib/site-url";

/**
 * The faces are imported as STYLESHEETS from packages in `node_modules`, rather
 * than fetched from fonts.googleapis.com by `next/font/google` while
 * `next build` runs — which made every build depend on reaching a third party
 * and fail behind a proxy, on a locked-down runner, or offline.
 *
 * A bare package import rather than `next/font/local` pointing INTO
 * `node_modules`: a literal path asserts where the package physically lives,
 * and that assertion is false under Yarn's Plug'n'Play linker (no
 * `node_modules` at all), under npm/Yarn workspace hoisting (the package moves
 * to the workspace root), and under pnpm's own symlinked store. An import asks
 * the resolver instead, which is correct under every layout.
 *
 * The trade is `next/font`'s metric-adjusted fallback, so text can shift
 * slightly as the face arrives. The families are bound to this app's `--font-*`
 * variables in `globals.css`, which is what every rule downstream reads. *
 * Importing the package root ships every subset the face offers — Latin, Latin
 * Extended, Cyrillic, Vietnamese — but each `@font-face` carries a
 * `unicode-range`, so a browser downloads only the subsets the page actually
 * uses. The deployed bundle is larger than a single hand-picked file; what a
 * reader fetches is not, and a page in Cyrillic now gets its face instead of a
 * fallback.
 */

/**
 * `metadataBase` tells Next.js how to resolve relative URLs in
 * OpenGraph images, Twitter images, and canonical URLs. Set
 * `NEXT_PUBLIC_SITE_URL` in your environment to your production
 * domain (e.g. `https://yourblog.com`). The localhost fallback keeps
 * dev working.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
