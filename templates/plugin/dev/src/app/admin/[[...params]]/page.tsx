"use client";

import "@nextlyhq/admin/style.css";
import { ErrorBoundary, QueryProvider, RootLayout } from "@nextlyhq/admin";

// Mounts the Nextly admin shell. Your plugin's menu/pages/settings appear here.
// The admin's data hooks read their client from QueryProvider, so RootLayout
// renders only inside it, as in an app scaffold.
export default function AdminPage() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error("Admin error:", error, errorInfo);
      }}
    >
      <QueryProvider>
        <RootLayout />
      </QueryProvider>
    </ErrorBoundary>
  );
}
