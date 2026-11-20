/**
 * The Content panel's "Waiting for my review" link opens a page of its own: its address resolves to
 * the waiting view, a signed-in screen in the Content section, never to Page Not Found.
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

describe("the waiting view's route", () => {
  it("resolves the sidebar link's address to the waiting view", () => {
    const route = resolveRoute(ROUTES.CONTENT_WAITING, "");

    expect(route.screenName).toBe("Waiting for my review");
    expect(route.routeType).toBe("private");
    expect(route.section).toBe("collections");
  });
});
