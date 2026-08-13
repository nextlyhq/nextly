import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

/**
 * The faces come from packages in `node_modules` rather than from
 * `next/font/google`, which fetches them from fonts.googleapis.com at BUILD
 * time — so a build behind a proxy, on a locked-down CI runner, or simply
 * offline fails at a step that has nothing to do with the app's code.
 *
 * `next/font/local` rather than the packages' own stylesheets, so the fonts
 * keep the same CSS variables the styles already reference, and keep the
 * metric-adjusted fallback that stops text reflowing once the face arrives.
 */
const display = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-display",
  display: "swap",
  // A variable font covering the whole axis in one file. Declared because the
  // filename is not something Next can infer a weight range from.
  weight: "100 900",
});

const mono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
});

/**
 * Blank-template root layout.
 *
 * Overrides templates/base/src/app/layout.tsx so the landing page can
 * use a distinctive font pairing (Bricolage Grotesque for display,
 * JetBrains Mono for tech accents). `metadataBase` is set so future
 * blank-template pages can use relative OG image URLs without breaking.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
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
      <body className={`${display.variable} ${mono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
