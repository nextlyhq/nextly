import { describe, expect, it } from "vitest";

import { NAV_SECTIONS, isNavSection } from "@admin/constants/nav-sections";
import { evaluateRouteSection } from "@admin/components/layout/sidebar/lib/resolve-section";
import type { RouteSectionContext } from "@admin/types/route-section";

import { routeConfig } from "../registry";

/**
 * Standing guard over the route-to-section declarations.
 *
 * The route type already makes a MISSING section a compile error. These cover
 * what the type cannot: that a declared resolver actually returns a rail entry
 * that exists, for every route, under the runtime shapes the sidebar passes.
 */

const privateRoutes = Object.entries(routeConfig).filter(
  ([, config]) => config.type === "private"
);

function context(
  overrides: Partial<RouteSectionContext> = {}
): RouteSectionContext {
  return {
    pathname: "/admin",
    collections: undefined,
    getCollectionPlacement: () => undefined,
    standalonePlugins: [],
    showBuilder: true,
    ...overrides,
  };
}

describe("every private route's declared section", () => {
  it("covers a population large enough to be meaningful", () => {
    // Asserted before any verdict below: a selector that silently matched
    // nothing would make every `it.each` here vacuously pass.
    expect(privateRoutes.length).toBeGreaterThan(40);
  });

  it.each(privateRoutes)("%s resolves to a real rail entry", (path, config) => {
    if (config.type !== "private") throw new Error("filtered to private");

    const resolved = evaluateRouteSection(
      config.section,
      context({ pathname: path })
    );

    // A standalone id names a plugin mounted at runtime, so it cannot be
    // checked against the static vocabulary — only its shape can.
    const valid =
      isNavSection(resolved) || /^standalone-[a-z0-9-]+$/.test(resolved);
    expect(valid, `${path} resolved to "${resolved}"`).toBe(true);
  });

  it.each(privateRoutes)(
    "%s still resolves when the builder is hidden",
    (path, config) => {
      if (config.type !== "private") throw new Error("filtered to private");

      const resolved = evaluateRouteSection(
        config.section,
        context({ pathname: path, showBuilder: false })
      );
      expect(NAV_SECTIONS).toContain(resolved);
    }
  );
});

describe("public routes", () => {
  it("declare no section, because they render outside the rail", () => {
    const publicRoutes = Object.values(routeConfig).filter(
      config => config.type === "public"
    );
    expect(publicRoutes.length).toBeGreaterThan(0);
    for (const config of publicRoutes) {
      expect("section" in config).toBe(false);
    }
  });
});
