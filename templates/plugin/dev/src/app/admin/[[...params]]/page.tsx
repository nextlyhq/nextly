"use client";

import "@nextlyhq/admin/style.css";
import { ErrorBoundary, QueryProvider, RootLayout } from "@nextlyhq/admin";

// Mounts the Nextly admin shell. Your plugin's menu/pages/settings appear here.
// QueryProvider is required: the admin's data hooks resolve their QueryClient
// from it, and mounting RootLayout without it crashes the page.
export default function AdminPage() {
  return (
    <ErrorBoundary>
      <QueryProvider>
        <RootLayout />
      </QueryProvider>
    </ErrorBoundary>
  );
}
