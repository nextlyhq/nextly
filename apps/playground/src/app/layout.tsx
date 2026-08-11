"use client";

import {
  CommandPalette,
  ErrorBoundary,
  QueryProvider,
  ThemeProvider,
} from "@nextlyhq/admin";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Inter,
  JetBrains_Mono,
  Lora,
  Open_Sans,
  Plus_Jakarta_Sans,
  Source_Serif_4,
} from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"], // Only load weights used in design system
});

// Self-hosted at build time (no runtime CDN fetch) so the Ink theme lab
// variant, which sets its serif token to var(--font-source-serif), has a
// real font to fall back on instead of the browser's default serif.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
});

// Same reasoning as sourceSerif above, for the Blueprint theme lab variant's
// var(--font-ibm-plex-mono) monospace token.
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

/**
 * The remaining faces the shortlisted presets name.
 *
 * A preset's font stack is data, and `next/font` does not resolve a bare
 * family name -- it generates a class and a variable, and a stack saying
 * "Plus Jakarta Sans, sans-serif" simply falls through to the system sans.
 * Every preset therefore previewed in Inter no matter what it declared, so the
 * typography axis of the comparison was measuring one font nine times.
 *
 * Loaded here rather than fetched at runtime for the same reason the two
 * above are: self-hosted at build time, no CDN request while comparing.
 * Variable fonts, so no weight list -- the whole axis is available.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={[
        inter.variable,
        sourceSerif.variable,
        ibmPlexMono.variable,
        plusJakartaSans.variable,
        openSans.variable,
        lora.variable,
        jetBrainsMono.variable,
        geist.variable,
        geistMono.variable,
      ].join(" ")}
      /**
       * suppressHydrationWarning is needed to prevent hydration errors caused by
       * browser extensions (e.g., Bitwarden, password managers) that inject
       * attributes like `bis_skin_checked` or `__processed_*` into DOM elements
       * before React hydrates. These attributes don't affect functionality but
       * would otherwise cause React hydration mismatch warnings.
       *
       * Applied to <html> tag to suppress warnings for entire component tree.
       *
       * @see https://react.dev/link/hydration-mismatch
       */
      suppressHydrationWarning
    >
      {/*
       * suppressHydrationWarning is also required on <body> because
       * `suppressHydrationWarning` on <html> only applies one level
       * deep. Browser extensions (Bitwarden, ColorZilla, Grammarly,
       * etc.) inject attributes onto <body> directly - e.g.
       * `cz-shortcut-listen="true"` - which would otherwise trigger
       * a separate React hydration warning here.
       *
       * @see https://react.dev/link/hydration-mismatch
       */}
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <ErrorBoundary
            onError={(error, errorInfo) => {
              // Log errors to console in development
              // In production, this would integrate with error tracking services
              // (Sentry, LogRocket, etc.)
              console.error("Error boundary caught error:", error, errorInfo);
            }}
          >
            <QueryProvider>
              {children}
              <CommandPalette />
            </QueryProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
