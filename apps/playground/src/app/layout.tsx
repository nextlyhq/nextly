"use client";

import {
  CommandPalette,
  ErrorBoundary,
  QueryProvider,
  ThemeProvider,
} from "@nextlyhq/admin";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by `next/font`, which exposes the face only as a
// CSS variable -- the admin theme names that variable first for exactly this
// reason. Weights are the four the design system declares; the rest would ship
// bytes nothing renders.
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// The mono face the admin reaches for on code surfaces: the API playground
// editor, ids, and inline code.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
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
