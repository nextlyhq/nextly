"use client";

import { Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { JSX } from "react";

import { Loader2 } from "@admin/components/icons";
import { useBrandingStatus } from "@admin/context/providers/BrandingProvider";
import { ADMIN_WORKSPACE_KEY } from "@admin/hooks/useSchemaUpdateInvalidation";

/**
 * What a plugin page's address shows while plugin pages are not yet known.
 *
 * Plugin pages register once admin-meta answers, so a direct load of one
 * resolves before any exists. Showing the not-found page then would call a
 * valid address missing; this holds a loading state instead, until the
 * registry is known and the router resolves the address again. If admin-meta
 * never answered, waiting would last forever, so it offers to ask again.
 */
export function PluginPageHold(): JSX.Element {
  const { isUnavailable } = useBrandingStatus();
  const queryClient = useQueryClient();

  if (isUnavailable) {
    return (
      <div
        role="alert"
        className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-4 p-8 text-center"
        data-testid="plugin-page-hold-error"
      >
        <p className="text-sm text-muted-foreground">
          This plugin page could not be loaded. Check your connection and try
          again.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void queryClient.refetchQueries({ queryKey: ADMIN_WORKSPACE_KEY })
          }
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex h-full min-h-64 w-full items-center justify-center"
      data-testid="plugin-page-hold"
    >
      <Loader2
        className="h-6 w-6 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}
