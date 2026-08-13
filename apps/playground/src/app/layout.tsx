"use client";

import {
  CommandPalette,
  ErrorBoundary,
  QueryProvider,
  ThemeProvider,
} from "@nextlyhq/admin";
import localFont from "next/font/local";
import "./globals.css";

// The face ships in `node_modules` rather than being fetched from
// fonts.googleapis.com at BUILD time, which made every build -- and the browser
// suite's global setup, which builds first -- depend on reaching a third party.
// It is still self-hosted from the app's own origin at runtime, and still
// exposed only as a CSS variable; the admin theme names that variable first for
// exactly this reason.
//
// One variable file covers the whole weight axis, which replaces the four
// static cuts the design system declares. That is fewer requests rather than
// more bytes: the discarded weights were separate files.
const geistSans = localFont({
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});

// The mono face the admin reaches for on code surfaces: the API playground
// editor, ids, and inline code.
const geistMono = localFont({
  src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
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
