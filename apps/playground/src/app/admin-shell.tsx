"use client";

import {
  CommandPalette,
  ErrorBoundary,
  QueryProvider,
  ThemeProvider,
} from "@nextlyhq/admin";

/**
 * The client runtime every admin surface needs, mounted by the layouts of the
 * surfaces that need it rather than by the root.
 *
 * These four are the admin's, not the site's. A theme the panel toggles, a
 * query cache the panel's data hooks read, an error boundary that keeps a
 * failed panel screen from blanking the tab, and a command palette bound to a
 * keyboard shortcut only an editor uses. Mounted at the root they reach every
 * URL in the app, so a public page — which renders on the server, hydrates
 * nothing of its own and offers no palette to open — still pays for the whole
 * admin client bundle.
 *
 * One component rather than a copy per layout, so the admin and the builder
 * harness routes compose the same tree. A harness that assembles a nearly
 * identical shell of its own is a different program from the one it stands in
 * for, and the ways it differs are exactly the ways its tests stop being
 * evidence about the product.
 *
 * @module app/admin-shell
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ErrorBoundary
        onError={(error, errorInfo) => {
          // In production this would reach an error tracking service.
          console.error("Error boundary caught error:", error, errorInfo);
        }}
      >
        <QueryProvider>
          {children}
          <CommandPalette />
        </QueryProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
