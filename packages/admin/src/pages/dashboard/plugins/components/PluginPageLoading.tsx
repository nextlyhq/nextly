"use client";

import type React from "react";

import { Loader2 } from "@admin/components/icons";

/**
 * What a plugin page shows while the data it suspends on is in flight.
 *
 * A `Suspense` fallback is not optional for these pages. `QueryErrorBoundary`
 * handles errors and nothing else, and the only boundary above it is
 * `RootLayout`'s `fallback={null}` — which exists to hide a lazy chunk
 * swapping in, not to stand in for a page. Without a local boundary a
 * suspending page is a blank screen for as long as the request takes.
 *
 * @module pages/dashboard/plugins/components/PluginPageLoading
 */
export function PluginPageLoading({
  label = "Loading…",
}: {
  label?: string;
}): React.ReactElement {
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}
