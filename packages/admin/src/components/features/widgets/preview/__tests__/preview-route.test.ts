/**
 * The widget preview address through the admin's own router.
 *
 * The separating properties: the page resolves only on the server's explicit
 * `true` (a truthy string, or an answer not yet in, is not one); before the
 * answer the address is held rather than drawn or called missing; after any
 * other answer it is the router's own not-found result, the same one an
 * address nobody serves gets; and the page's module is never evaluated until
 * the router hands out the page and something renders or preloads it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import { setWidgetPreviewsAnswer } from "../preview-route";

/** Whether the page's module has been evaluated. */
const evaluated = vi.hoisted(() => ({ page: false }));
vi.mock("@admin/pages/dashboard/widget-previews", () => {
  evaluated.page = true;
  return { default: () => null };
});

afterEach(() => {
  setWidgetPreviewsAnswer(undefined);
});

/** What the router answers an address no route serves. */
const NOT_FOUND = resolveRoute("/admin/dev/no-such-page", "");

function preloadOf(component: unknown): (() => void) | undefined {
  const preload: unknown =
    typeof component === "function"
      ? (component as { preload?: unknown }).preload
      : undefined;
  return typeof preload === "function" ? (preload as () => void) : undefined;
}

describe("the widget preview address", () => {
  it("is held while the server has not answered, naming nothing", () => {
    const held = resolveRoute(ROUTES.WIDGET_PREVIEWS, "");
    expect(held.routeType).toBe("private");
    expect(held.screenName).toBeUndefined();
    expect(preloadOf(held.Component)).toBeUndefined();
    expect(evaluated.page).toBe(false);
  });

  it("is not found, as an unserved address is, on any answer but an explicit yes", () => {
    for (const answer of [
      false,
      "true" as unknown as boolean,
      1 as unknown as boolean,
    ]) {
      setWidgetPreviewsAnswer(answer);
      const route = resolveRoute(ROUTES.WIDGET_PREVIEWS, "");
      expect(route.screenName, String(answer)).toBe(NOT_FOUND.screenName);
      expect(route.screenName).toBe("Page Not Found");
      expect(preloadOf(route.Component)).toBeUndefined();
    }
    expect(evaluated.page).toBe(false);
  });

  it("is the page on the server's yes, its module fetched only when asked for", async () => {
    expect(setWidgetPreviewsAnswer(true)).toBe(true);
    const route = resolveRoute(ROUTES.WIDGET_PREVIEWS, "");
    expect(route.screenName).toBe("Widget previews");
    expect(route.section).toBe("dashboard");
    // Resolving hands out the lazy route, and evaluates nothing.
    expect(evaluated.page).toBe(false);
    const preload = preloadOf(route.Component);
    expect(preload).toBeDefined();
    preload?.();
    await vi.waitFor(() => expect(evaluated.page).toBe(true));
  });

  it("says when the answer moved, so the router resolves the address again", () => {
    expect(setWidgetPreviewsAnswer(false)).toBe(true);
    expect(setWidgetPreviewsAnswer(false)).toBe(false);
    expect(setWidgetPreviewsAnswer(true)).toBe(true);
  });
});
