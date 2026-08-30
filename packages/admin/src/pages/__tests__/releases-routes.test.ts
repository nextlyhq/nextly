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

import { ROUTES, buildRoute } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import ReleaseDetailPage from "../dashboard/releases/[id]";
import ReleasesPage from "../dashboard/releases/index";

describe("the release routes", () => {
  it("resolves the list to the releases page", () => {
    const resolved = resolveRoute(ROUTES.RELEASES, "");
    expect(resolved.Component).toBe(ReleasesPage);
    expect(resolved.requiredPermission).toBe("read-content-releases");
  });

  it("resolves a detail link to the detail page, with its id", () => {
    // Built the way the list builds it, so a change to the template moves both
    // sides together and this cannot pass against a link nothing produces.
    const href = buildRoute(ROUTES.RELEASES_DETAIL, { id: "rel_01H8" });
    const resolved = resolveRoute(href, "");

    // Component identity rather than "not NotFound": the resolver's fallback is
    // a component too, so anything weaker passes on the unregistered route this
    // test exists to catch.
    expect(resolved.Component).toBe(ReleaseDetailPage);
    expect(resolved.params).toEqual({ id: "rel_01H8" });
    expect(resolved.requiredPermission).toBe("read-content-releases");
  });

  it("does not let the list route swallow the detail one", () => {
    // The control for the case above: the two must be DIFFERENT components, so
    // a registry where the detail pattern silently matched the list page would
    // fail here rather than reading as a working link.
    expect(ReleaseDetailPage).not.toBe(ReleasesPage);
    expect(resolveRoute(ROUTES.RELEASES, "").Component).not.toBe(
      resolveRoute(buildRoute(ROUTES.RELEASES_DETAIL, { id: "x" }), "")
        .Component
    );
  });
});
