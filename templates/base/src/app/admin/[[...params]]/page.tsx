"use client";

import "@nextlyhq/admin/style.css";
// Registers every plugin admin component the app's config declares. Generated
// by `nextly generate:types`, and rewritten by `next dev` when it falls behind.
import "../../../types/generated/plugin-admin-imports.generated";
import { RootLayout, QueryProvider, ErrorBoundary } from "@nextlyhq/admin";

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
