/**
 * The widget preview page, for a development server only.
 *
 * Reached only through `components/features/widgets/preview/preview-route`,
 * which resolves its address to this module's lazy chunk only on the running
 * server's explicit development answer; the page registry does not list it,
 * so no eager import of the admin reaches this file.
 *
 * @module pages/dashboard/widget-previews
 */

"use client";

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { useWidgetPreviews } from "@admin/components/features/widgets/preview/useWidgetPreviews";
import { WidgetPreviewsView } from "@admin/components/features/widgets/preview/WidgetPreviewsView";
import { Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";

export default function WidgetPreviewsPage(): JSX.Element {
  const previews = useWidgetPreviews();

  return (
    <PageContainer>
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
    </PageContainer>
  );
}
