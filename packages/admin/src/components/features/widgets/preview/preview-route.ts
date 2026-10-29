/**
 * Whether the widget preview page is registered, and the route it resolves to.
 *
 * 🔴 The page exists only on the running server's explicit yes
 * (`AdminBranding.widgetPreviews`). This package is prebuilt, so its own
 * `NODE_ENV` says where the library was built, never where it runs; the
 * server's answer, from the same check that gates the page's read, is the
 * only one that can say "development". Until it arrives the address is held,
 * as a plugin page's is, and once it says anything but `true` the address is
 * resolved as any address the admin does not serve: the not-found page.
 *
 * The page's code is a lazy chunk, fetched only when this module hands the
 * router the page, which is only after that yes: nothing in the admin's eager
 * graph imports it, and the route preloader (`lib/routing`) asks this same
 * resolution, so a hovered link cannot fetch it ahead of the answer either.
 *
 * Module-level, as the plugin page registry is: the router resolves an address
 * outside React, and `WidgetPreviewsRegistrar` writes the answer here and asks
 * the router to resolve the current address again when it changes.
 *
 * @module components/features/widgets/preview/preview-route
 */

import React from "react";

import { ROUTES } from "@admin/constants/routes";
import type { RouteResult } from "@admin/lib/routing";
import { lazyRoute } from "@admin/pages/lazy-route";

import { WidgetPreviewsHold } from "./WidgetPreviewsHold";

/**
 * The page, as a lazily fetched route. Declared here rather than in the page
 * registry, whose every entry is a route the router always resolves.
 */
const WidgetPreviewsPage = lazyRoute(
  () => import("@admin/pages/dashboard/widget-previews")
);

/** The server's answer: `undefined` until the workspace half has answered. */
let answer: boolean | undefined;

/**
 * Records the server's answer, read as only an explicit `true` being a yes.
 * Returns whether the answer moved, so the caller knows to have the router
 * resolve the current address again.
 */
export function setWidgetPreviewsAnswer(next: boolean | undefined): boolean {
  const recorded = next === undefined ? undefined : next === true;
  if (recorded === answer) return false;
  answer = recorded;
  return true;
}

/**
 * The route the preview address resolves to: the page on a yes, a hold while
 * the answer is unknown, and `undefined` (the router's not-found) otherwise
 * and for every other address.
 */
export function widgetPreviewsRoute(
  pathname: string,
  searchParams: RouteResult["searchParams"]
): RouteResult | undefined {
  if (pathname.replace(/\/$/, "") !== ROUTES.WIDGET_PREVIEWS) return undefined;
  if (answer === true) {
    return {
      Component: WidgetPreviewsPage,
      params: {},
      searchParams,
      routeType: "private",
      section: "dashboard",
      screenName: "Widget previews",
    };
  }
  if (answer === undefined) {
    // Private, as the page would be, so the session check starts during the
    // hold; and named nothing, so the tab says nothing a production visit's
    // not-found page would not.
    return {
      Component: () => React.createElement(WidgetPreviewsHold),
      params: {},
      searchParams,
      routeType: "private",
      section: "dashboard",
    };
  }
  return undefined;
}
