import { describe, expect, it } from "vitest";

import {
  getSidebarCollectionsForLanding,
  getSidebarSinglesForLanding,
  pickCollectionsLandingTarget,
  pickSinglesLandingTarget,
} from "../sidebar-landing";

import type { AdminBranding } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

// Tests run with a super-admin capabilities stub so the permission filter
// never excludes anything — these tests are about ordering semantics.
const superAdmin: AdminCapabilities = {
  isSuperAdmin: true,
  canViewCollections: true,
  canViewUsers: true,
  canViewRoles: true,
  canViewMedia: true,
  canViewSettings: true,
  collections: {},
  canManageUsers: true,
  canManageRoles: true,
  canManageMedia: true,
  canManageSettings: true,
  canManageEmailProviders: true,
  canManageEmailTemplates: true,
  canManageImageSizes: true,
  canManageStoredFiles: true,
  canManagePluginSettings: true,
} as AdminCapabilities;

const noBranding: AdminBranding = {};

function makeCollection(
  name: string,
  overrides: Partial<ApiCollection["admin"]> & {
    label?: string;
    pluralLabel?: string;
  } = {}
): ApiCollection {
  const { label, pluralLabel, ...adminOverrides } = overrides;
  return {
    id: `id-${name}`,
    name,
    label: label ?? name,
    tableName: name,
    schemaDefinition: { fields: [] },
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    labels: pluralLabel ? { plural: pluralLabel } : undefined,
    admin: { ...adminOverrides },
  } as unknown as ApiCollection;
}

function makeSingle(
  slug: string,
  overrides: Partial<ApiSingle["admin"]> & { label?: string } = {}
): ApiSingle {
  const { label, ...adminOverrides } = overrides;
  return {
    id: `id-${slug}`,
    slug,
    label: label ?? slug,
    tableName: slug,
    fields: [],
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    admin: { ...adminOverrides },
  } as unknown as ApiSingle;
}

describe("getSidebarCollectionsForLanding", () => {
  it("returns an empty array when items is empty", () => {
    expect(
      getSidebarCollectionsForLanding([], {
        branding: noBranding,
        capabilities: superAdmin,
        pinnedCollections: new Set(),
      })
    ).toEqual([]);
  });

  it("places pinned items before everything regardless of order", () => {
    const items = [
      makeCollection("authors", { order: 1 }),
      makeCollection("posts", { order: 50 }),
    ];
    const result = getSidebarCollectionsForLanding(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(["posts"]),
    });
    expect(result.map(c => c.name)).toEqual(["posts", "authors"]);
  });

  it("orders by admin.order ascending before alphabetical", () => {
    const items = [
      makeCollection("zebras", { order: 1 }),
      makeCollection("alligators", { order: 5 }),
    ];
    const result = getSidebarCollectionsForLanding(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(result.map(c => c.name)).toEqual(["zebras", "alligators"]);
  });

  it("falls back to alphabetical (by plural label) when orders tie", () => {
    const items = [
      makeCollection("zebras", { order: 100, pluralLabel: "Zebras" }),
      makeCollection("alligators", { order: 100, pluralLabel: "Alligators" }),
    ];
    const result = getSidebarCollectionsForLanding(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(result.map(c => c.name)).toEqual(["alligators", "zebras"]);
  });

  it("treats missing admin.order as 100 (the documented default)", () => {
    const items = [
      makeCollection("explicit", { order: 50 }),
      makeCollection("implicit"), // no order — defaults to 100
    ];
    const result = getSidebarCollectionsForLanding(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(result.map(c => c.name)).toEqual(["explicit", "implicit"]);
  });

  it("excludes hidden collections", () => {
    const items = [
      makeCollection("visible"),
      makeCollection("hidden", { hidden: true }),
    ];
    const result = getSidebarCollectionsForLanding(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(result.map(c => c.name)).toEqual(["visible"]);
  });

  it("excludes plugin collections by default but includes them when plugin metadata sets placement to 'collections'", () => {
    const items = [
      makeCollection("posts"),
      makeCollection("forms", { isPlugin: true }),
    ];
    // First: with no plugin metadata, the plugin collection is excluded.
    const withoutMeta = getSidebarCollectionsForLanding(items, {
      branding: { plugins: [] },
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(withoutMeta.map(c => c.name)).toEqual(["posts"]);

    // Then: metadata that places the plugin's collection in the
    // "collections" section pulls it back in.
    const withMeta = getSidebarCollectionsForLanding(items, {
      branding: {
        plugins: [
          {
            name: "form-builder",
            collections: ["forms"],
            placement: "collections",
          },
        ],
      },
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(withMeta.map(c => c.name).sort()).toEqual(["forms", "posts"]);
  });
});

describe("pickCollectionsLandingTarget", () => {
  it("returns null when no collections are visible", () => {
    expect(
      pickCollectionsLandingTarget([], {
        branding: noBranding,
        capabilities: superAdmin,
        pinnedCollections: new Set(),
      })
    ).toBeNull();
  });

  it("returns the first item the sidebar would render", () => {
    const items = [
      makeCollection("zebras", { order: 100 }),
      makeCollection("alligators", { order: 100 }),
      makeCollection("posts", { order: 1 }),
    ];
    const target = pickCollectionsLandingTarget(items, {
      branding: noBranding,
      capabilities: superAdmin,
      pinnedCollections: new Set(),
    });
    expect(target?.name).toBe("posts");
  });
});

describe("getSidebarSinglesForLanding + pickSinglesLandingTarget", () => {
  it("uses the same pinned/order/name comparator as collections", () => {
    const items = [
      makeSingle("zebras", { order: 1 }),
      makeSingle("alligators", { order: 5 }),
      makeSingle("kittens", { order: 5 }),
    ];
    const result = getSidebarSinglesForLanding(items, {
      capabilities: superAdmin,
      pinnedSingles: new Set(["kittens"]),
    });
    expect(result.map(s => s.slug)).toEqual([
      "kittens", // pinned wins
      "zebras", // order=1 next
      "alligators", // order=5 first alphabetically
    ]);
  });

  it("excludes hidden singles", () => {
    const items = [
      makeSingle("visible"),
      makeSingle("hidden", { hidden: true }),
    ];
    const result = getSidebarSinglesForLanding(items, {
      capabilities: superAdmin,
      pinnedSingles: new Set(),
    });
    expect(result.map(s => s.slug)).toEqual(["visible"]);
  });

  it("returns null when no singles are visible", () => {
    expect(
      pickSinglesLandingTarget([], {
        capabilities: superAdmin,
        pinnedSingles: new Set(),
      })
    ).toBeNull();
  });
});
