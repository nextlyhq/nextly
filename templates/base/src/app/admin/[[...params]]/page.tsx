"use client";

import "@nextlyhq/admin/style.css";
// Registers every plugin admin component the app's config declares. Generated
// by `nextly generate:types`; run it again after adding or changing a plugin.
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
