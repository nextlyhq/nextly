"use client";

// Plugin-side admin imports. Every scaffold ships @revnixhq/plugin-form-builder
// as a dependency (see packages/create-nextly-app utils/template.ts). These
// three lines register the plugin's custom admin field components and load its
// CSS so the Forms collection's drag-and-drop field builder and Submissions
// filter UI render correctly. Without them, Forms still appears in the sidebar
// but the builder falls back to plain JSON/text inputs.
import "@revnixhq/admin/style.css";
import "@revnixhq/plugin-form-builder/admin";
import "@revnixhq/plugin-form-builder/styles/builder.css";
import "@revnixhq/plugin-form-builder/styles/submissions-filter.css";
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
