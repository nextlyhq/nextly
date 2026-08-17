import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import type { ApiCollection } from "@admin/types/entities";

import {
  resolveActiveSection,
  type ActiveSectionContext,
} from "../lib/resolve-section";

/**
 * A collection carrying only the fields section resolution reads. The rest of
 * `ApiCollection` is filled with inert values so a change to those fields
 * cannot alter what these cases assert.
 */
function collection(name: string, isPlugin: boolean): ApiCollection {
  return {
    id: name,
    name,
    label: name,
    tableName: name,
    schemaDefinition: { fields: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    admin: isPlugin ? { isPlugin: true } : undefined,
  };
}

/**
 * Defaults chosen so each case states only the input it is about. Placement
 * returns undefined unless a case supplies a map, which is the "no placement
 * declared" state rather than a stand-in for one.
 */
function context(
  overrides: Partial<ActiveSectionContext> = {}
): ActiveSectionContext {
  return {
    pathname: "/admin",
    collections: undefined,
    getCollectionPlacement: () => undefined,
    standalonePlugins: [],
    showBuilder: true,
    ...overrides,
  };
}

function placementFrom(
  map: Record<string, string>
): (c: ApiCollection) => string | undefined {
  return c => map[c.name];
}

describe("resolveActiveSection", () => {
  describe("standalone plugins outrank every shared section", () => {
    it("claims its own rail entry for one of its collections", () => {
      expect(
        resolveActiveSection(
          context({
            pathname: "/admin/collections/tickets",
            standalonePlugins: [
              { name: "@acme/helpdesk", collections: ["tickets"] },
            ],
          })
        )
      ).toBe("standalone-acme-helpdesk");
    });

    it("does not claim a collection it does not own", () => {
      expect(
        resolveActiveSection(
          context({
            pathname: "/admin/collections/posts",
            standalonePlugins: [
              { name: "@acme/helpdesk", collections: ["tickets"] },
            ],
          })
        )
      ).toBe("collections");
    });
  });

  describe("a plugin collection is classified by its PLACEMENT, not its URL", () => {
    // Each of these is an ordinary /admin/collections/<name> URL, so a
    // URL-shaped check alone would answer "collections" for all four.
    it.each([
      ["users", "settings"],
      ["settings", "settings"],
      ["collections", "collections"],
      ["singles", "singles"],
    ])("placement %s resolves to %s", (placement, expected) => {
      expect(
        resolveActiveSection(
          context({
            pathname: "/admin/collections/audit-log",
            collections: [collection("audit-log", true)],
            getCollectionPlacement: placementFrom({ "audit-log": placement }),
          })
        )
      ).toBe(expected);
    });

    it("falls to Plugins when its plugin declares no placement", () => {
      expect(
        resolveActiveSection(
          context({
            pathname: "/admin/collections/audit-log",
            collections: [collection("audit-log", true)],
          })
        )
      ).toBe("plugins");
    });

    it("leaves a NON-plugin collection to the Collections arm", () => {
      expect(
        resolveActiveSection(
          context({
            pathname: "/admin/collections/posts",
            collections: [collection("posts", false)],
          })
        )
      ).toBe("collections");
    });
  });

  describe("plugin surfaces", () => {
    it.each([
      [ROUTES.PLUGINS, "the installed list"],
      [`${ROUTES.PLUGINS}/some-plugin`, "a plugin detail page"],
      [ROUTES.PLUGIN_BROWSE, "the directory at its own top level"],
      ["/admin/forms", "the forms surface"],
    ])("%s resolves to Plugins (%s)", pathname => {
      expect(resolveActiveSection(context({ pathname }))).toBe("plugins");
    });
  });

  describe("the `from` param decides ahead of the URL", () => {
    it.each(["builders", "collections", "singles"])(
      "from=%s wins over the path it was reached from",
      from => {
        expect(
          resolveActiveSection(context({ pathname: ROUTES.MEDIA, from }))
        ).toBe(from);
      }
    );

    it("does NOT override a plugin surface, which is decided earlier", () => {
      expect(
        resolveActiveSection(
          context({ pathname: ROUTES.PLUGINS, from: "collections" })
        )
      ).toBe("plugins");
    });

    it("ignores a repeated param, which the router reports as an array", () => {
      expect(
        resolveActiveSection(
          context({ pathname: ROUTES.MEDIA, from: ["builders", "collections"] })
        )
      ).toBe("media");
    });
  });

  describe("schema-management URLs", () => {
    it("selects Builders while the builder is enabled", () => {
      expect(
        resolveActiveSection(
          context({ pathname: "/admin/builder/collections/posts" })
        )
      ).toBe("builders");
    });

    it.each([
      ["/admin/builder/collections/posts", "collections"],
      ["/admin/builder/singles/homepage", "singles"],
      ["/admin/builder/field-groups/seo", "collections"],
    ])(
      "%s falls back to %s when the builder is hidden",
      (pathname, expected) => {
        expect(
          resolveActiveSection(context({ pathname, showBuilder: false }))
        ).toBe(expected);
      }
    );
  });

  describe("content and settings URLs", () => {
    it.each([
      ["/admin/collections/posts", "collections"],
      ["/admin/singles/homepage", "singles"],
      [ROUTES.MEDIA, "media"],
      ["/admin/users", "settings"],
      ["/admin/security/roles", "settings"],
      [ROUTES.SETTINGS, "settings"],
      [ROUTES.DASHBOARD, "dashboard"],
    ])("%s resolves to %s", (pathname, expected) => {
      expect(resolveActiveSection(context({ pathname }))).toBe(expected);
    });
  });

  describe("an unmapped route", () => {
    /**
     * Pins the CURRENT behaviour so a later change to it is visible as a
     * deliberate edit to this expectation rather than as a silent difference.
     * A route nobody classified answers Dashboard, which is indistinguishable
     * from a route that genuinely is Dashboard.
     */
    it("silently answers Dashboard", () => {
      expect(
        resolveActiveSection(context({ pathname: "/admin/plugin-directory-x" }))
      ).toBe("dashboard");
      expect(
        resolveActiveSection(context({ pathname: "/admin/some-new-surface" }))
      ).toBe("dashboard");
    });
  });
});
