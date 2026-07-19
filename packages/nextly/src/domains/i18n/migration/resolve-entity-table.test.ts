// The archive records an entity SLUG, but replaying rows needs the physical `_locales` table.
// `nextly i18n:restore --collection pages` depends on this mapping being right for all three
// entity kinds, so it is pinned here.

import { describe, expect, it } from "vitest";

import { resolveEntityTable } from "./resolve-entity-table";

describe("resolveEntityTable", () => {
  it("maps a collection slug to dc_<slug>_locales", () => {
    const r = resolveEntityTable({ collections: [{ slug: "pages" }] }, "pages");
    expect(r).toEqual({
      tableName: "dc_pages",
      companionTableName: "dc_pages_locales",
      kind: "collection",
    });
  });

  it("maps a single slug to single_<slug>_locales", () => {
    const r = resolveEntityTable(
      { singles: [{ slug: "site-settings" }] },
      "site-settings"
    );
    // Dashes become underscores, matching the table the migration actually created.
    expect(r?.companionTableName).toBe("single_site_settings_locales");
    expect(r?.kind).toBe("single");
  });

  it("maps a component slug to comp_<slug>_locales", () => {
    const r = resolveEntityTable({ components: [{ slug: "seo" }] }, "seo");
    expect(r?.companionTableName).toBe("comp_seo_locales");
    expect(r?.kind).toBe("component");
  });

  it("honors an explicit dbName over the prefix convention", () => {
    const r = resolveEntityTable(
      { collections: [{ slug: "pages", dbName: "custom_pages" }] },
      "pages"
    );
    expect(r?.tableName).toBe("custom_pages");
    expect(r?.companionTableName).toBe("custom_pages_locales");
  });

  it("returns null for an unknown slug (command reports it instead of guessing a table)", () => {
    expect(resolveEntityTable({ collections: [{ slug: "pages" }] }, "nope")).toBeNull();
  });

  it("returns null on an empty config", () => {
    expect(resolveEntityTable({}, "pages")).toBeNull();
  });

  it("finds the slug regardless of which group it lives in", () => {
    const config = {
      collections: [{ slug: "pages" }],
      singles: [{ slug: "site-settings" }],
      components: [{ slug: "seo" }],
    };
    expect(resolveEntityTable(config, "seo")?.kind).toBe("component");
    expect(resolveEntityTable(config, "site-settings")?.kind).toBe("single");
  });
});
