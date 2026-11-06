"use client";

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";

/**
 * The way to the widget preview page, in customise mode's bar beside its other
 * secondary actions, and drawn as they are, so it is read as they are. It is
 * drawn only on the running server's explicit development answer, the same
 * answer that registers the page (`preview-route`); elsewhere it draws
 * nothing, so a production admin has no link to an address it does not serve.
 */
export function WidgetPreviewsLink(): JSX.Element | null {
  const { widgetPreviews } = useBranding();
  if (widgetPreviews !== true) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={ROUTES.WIDGET_PREVIEWS} data-testid="widget-previews-link">
        <Icons.Eye aria-hidden className="mr-2 size-4" />
        Preview widgets
      </Link>
    </Button>
  );
}
