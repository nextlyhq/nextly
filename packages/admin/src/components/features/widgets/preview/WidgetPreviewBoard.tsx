"use client";

/**
 * The widget preview board: every widget the reader may see, drawn from its
 * declared preview cases in every state, with the accessibility check the
 * browser tests run on each drawn state, in light and dark.
 *
 * 🔴 For tests alone. Exported from the admin's test entry
 * (`@nextlyhq/admin/testing`), which no admin module imports, so none of this
 * reaches the admin a site ships. The browser tests' app draws it on a page
 * of its own, inside the admin, so every card is drawn with the admin's own
 * declarations, theme and permissions, exactly as the dashboard draws it. Its
 * read (`GET /api/_dev/widget-previews`) is served by a development server
 * alone.
 *
 * @module components/features/widgets/preview/WidgetPreviewBoard
 * @experimental For tests; its markup is what the browser tests read.
 */

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Loader2 } from "@admin/components/icons";

import { useWidgetPreviews } from "./useWidgetPreviews";
import { WidgetPreviewsView } from "./WidgetPreviewsView";

export function WidgetPreviewBoard(): JSX.Element {
  const previews = useWidgetPreviews();

  return (
    <div className="mx-auto max-w-[1600px] py-6 lg:py-10">
      {previews.isPending ? (
        <div
          role="status"
          className="flex min-h-64 items-center justify-center"
          data-testid="widget-previews-loading"
        >
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Loading the widget previews</span>
        </div>
      ) : previews.isError ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertDescription className="space-y-3">
            <p>The widget previews could not be loaded.</p>
            <Button
              variant="outline"
              size="md"
              onClick={() => void previews.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <WidgetPreviewsView previews={previews.data} />
      )}
    </div>
  );
}
