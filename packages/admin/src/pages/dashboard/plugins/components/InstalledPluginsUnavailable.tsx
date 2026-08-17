"use client";

import { useQueryClient } from "@tanstack/react-query";
import type React from "react";

import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";

/**
 * What a plugins page shows when the installed list never arrived.
 *
 * Distinct from the catalogue's "not installed" view, which STATES the plugin
 * is absent — a claim no page can make from a request that failed. Every
 * surface here reads installation from one list, so an unanswered request has
 * to be reported rather than rendered as an empty result.
 *
 * The provider serves that list through `useBranding`, which neither suspends
 * nor throws, so a surrounding `Suspense` or error boundary never sees the
 * failure and each page shows this itself.
 *
 * @module pages/dashboard/plugins/components/InstalledPluginsUnavailable
 */
export function InstalledPluginsUnavailable(): React.ReactElement {
  const queryClient = useQueryClient();

  return (
    <SectionErrorFallback
      title="Could not load your installed plugins"
      description="This page cannot tell which plugins are installed until the admin metadata loads."
      reset={() => {
        // Both halves: the list lives in the workspace query, and a caller
        // retrying from here means "fetch the admin metadata again" rather
        // than naming one of the two requests it is split across.
        void queryClient.invalidateQueries({ queryKey: ["admin-meta"] });
      }}
    />
  );
}
