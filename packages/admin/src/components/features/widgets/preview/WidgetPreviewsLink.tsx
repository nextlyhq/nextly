"use client";

import type { JSX } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";

/**
 * The dashboard's way to the widget preview page, drawn only on the running
 * server's explicit development answer, the same answer that registers the
 * page (`preview-route`). Elsewhere it draws nothing, so a production admin
 * has no link to an address it does not serve.
 */
export function WidgetPreviewsLink(): JSX.Element | null {
  const { widgetPreviews } = useBranding();
  if (widgetPreviews !== true) return null;
  return (
    <Link
      href={ROUTES.WIDGET_PREVIEWS}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      data-testid="widget-previews-link"
    >
      Preview widgets
    </Link>
  );
}
