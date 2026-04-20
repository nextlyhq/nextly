"use client";

import "@revnixhq/admin/style.css";
import { RootLayout, QueryProvider, ErrorBoundary } from "@revnixhq/admin";

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
