"use client";

import { Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { JSX } from "react";

import { Loader2 } from "@admin/components/icons";
import { useBrandingStatus } from "@admin/context/providers/BrandingProvider";
import { ADMIN_WORKSPACE_KEY } from "@admin/hooks/useSchemaUpdateInvalidation";

/**
 * What the widget preview address shows before the server has said whether
 * it is in development: a loading state, since calling the address missing
 * before the answer would be a guess. Says nothing of a preview page, so a
 * production visit learns nothing from it before its not-found page. If the
 * answer never came, it offers to ask again, as a held plugin page does.
 */
export function WidgetPreviewsHold(): JSX.Element {
  const { isUnavailable } = useBrandingStatus();
  const queryClient = useQueryClient();

  if (isUnavailable) {
    return (
      <div
        role="alert"
        className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-4 p-8 text-center"
        data-testid="widget-previews-hold-error"
      >
        <p className="text-sm text-muted-foreground">
          This page could not be loaded. Check your connection and try again.
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
      data-testid="widget-previews-hold"
    >
      <Loader2
        className="h-6 w-6 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}
