import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

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
 * Blank-template root layout.
 *
 * Overrides templates/base/src/app/layout.tsx so the landing page can
 * use a distinctive font pairing (Bricolage Grotesque for display,
 * JetBrains Mono for tech accents). `metadataBase` is set so future
 * blank-template pages can use relative OG image URLs without breaking.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Nextly", template: "%s — Nextly" },
  description: "A Nextly project.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
