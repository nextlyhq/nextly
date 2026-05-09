"use client";

import {
  CommandPalette,
  ErrorBoundary,
  QueryProvider,
  ThemeProvider,
} from "@nextlyhq/admin";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"], // Only load weights used in design system
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={inter.variable}
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
