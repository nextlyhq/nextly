"use client";

// The blog template registers `formBuilderPlugin` in nextly.config.ts. These
// imports register its admin field components and load its CSS so the Forms
// collection's drag-and-drop builder and Submissions filter UI render
// correctly. Without them, Forms still appears in the sidebar but the builder
// falls back to plain JSON/text inputs.
import "@nextlyhq/admin/style.css";
import "@nextlyhq/plugin-form-builder/admin";
import "@nextlyhq/plugin-form-builder/styles/submissions-filter.css";
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
