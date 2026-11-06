"use client";

import { useEffect } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";

import { setWidgetPreviewsAnswer } from "./preview-route";

/**
 * Side-effect-only component (renders nothing) that keeps the widget preview
 * route in step with the server's answer, beside `PluginPageRegistrar`.
 *
 * The answer is unknown while the workspace half is in flight or failed, and
 * otherwise the server's `widgetPreviews`, where only `true` registers the
 * page. When it moves, the router is asked to resolve the current address
 * again, as the plugin page registry asks: a direct visit resolved before the
 * answer is then drawn as the page, or as not found, rather than held.
 */
export function WidgetPreviewsRegistrar(): null {
  const { widgetPreviews } = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();
  const answered = !isPending && !isUnavailable;

  useEffect(() => {
    const moved = setWidgetPreviewsAnswer(
      answered ? widgetPreviews === true : undefined
    );
    if (moved && typeof window !== "undefined") {
      window.dispatchEvent(new Event("locationchange"));
    }
  }, [answered, widgetPreviews]);

  return null;
}
