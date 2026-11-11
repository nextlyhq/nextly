"use client";

/**
 * The widget check's page, registered by a side-effect import in the
 * playground's admin route, as a real app loads a plugin's admin components.
 *
 * The board is the admin's own (`@nextlyhq/admin/testing`, the entry no admin
 * module imports), fetched only when the page is drawn, so the playground's
 * admin loads none of it until a test opens the page.
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";
import { lazy, Suspense } from "react";

import { WIDGET_CHECK_PAGE_PATH } from "./constants";

const WidgetPreviewBoard = lazy(async () => ({
  default: (await import("@nextlyhq/admin/testing")).WidgetPreviewBoard,
}));

function WidgetCheckPage() {
  return (
    <Suspense fallback={null}>
      <WidgetPreviewBoard />
    </Suspense>
  );
}

registerComponents({ [WIDGET_CHECK_PAGE_PATH]: WidgetCheckPage });
