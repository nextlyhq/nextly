/**
 * That the release routes RESOLVE, rather than merely being declared.
 *
 * Comparing route constants to each other proves the strings agree and nothing
 * about whether a link built from them reaches a page: an unregistered template
 * matches no pattern, so `resolveRoute` falls through to `NotFoundPage` while
 * every constant is exactly as intended. This asks the resolver the question a
 * click asks it.
 *
 * @module pages/__tests__/releases-routes.test
 */
import { describe, expect, it } from "vitest";

import { RELEASE_SECTION_PERMISSIONS } from "@admin/constants/navigation";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import { routeConfig } from "../registry";

describe("the release routes", () => {
  it("resolves the list to the releases page", () => {
    const resolved = resolveRoute(ROUTES.RELEASES, "");
    // The registry holds the route's on-demand wrapper (the page's chunk is
    // fetched when the route renders), so identity is against the table's
    // entry, which is what the resolver hands back for a registered route.
    expect(resolved.Component).toBe(routeConfig[ROUTES.RELEASES].component);
    expect(resolved.requiredPermission).toEqual(RELEASE_SECTION_PERMISSIONS);
  });

  it("resolves a detail link to the detail page, with its id", () => {
    // Built the way the list builds it, so a change to the template moves both
    // sides together and this cannot pass against a link nothing produces.
    const href = buildRoute(ROUTES.RELEASES_DETAIL, { id: "rel_01H8" });
    const resolved = resolveRoute(href, "");

    // Component identity rather than "not NotFound": the resolver's fallback is
    // a component too, so anything weaker passes on the unregistered route this
    // test exists to catch.
    expect(resolved.Component).toBe(
      routeConfig[ROUTES.RELEASES_DETAIL].component
    );
    expect(resolved.params).toEqual({ id: "rel_01H8" });
    // The detail is gated no more loosely than the list it is reached from,
    // which would otherwise be a way around the list's own gate.
    expect(resolved.requiredPermission).toEqual(RELEASE_SECTION_PERMISSIONS);
  });

  it("does not let the list route swallow the detail one", () => {
    // The control for the case above: the two must be DIFFERENT components, so
    // a registry where the detail pattern silently matched the list page would
    // fail here rather than reading as a working link.
    expect(routeConfig[ROUTES.RELEASES_DETAIL].component).not.toBe(
      routeConfig[ROUTES.RELEASES].component
    );
    expect(resolveRoute(ROUTES.RELEASES, "").Component).not.toBe(
      resolveRoute(buildRoute(ROUTES.RELEASES_DETAIL, { id: "x" }), "")
        .Component
    );
  });
});
