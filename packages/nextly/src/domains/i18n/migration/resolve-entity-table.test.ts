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

  // `i18n:restore` tries the authored config first and the persisted UI-schema
  // manifest second. Those spell the field-group key differently, so both have
  // to resolve or a code-first group is reported missing and its archived
  // translations can never be replayed.
  it("maps a field group from an authored config (`fieldGroups`)", () => {
    const r = resolveEntityTable({ fieldGroups: [{ slug: "seo" }] }, "seo");
    expect(r).toEqual({
      tableName: "comp_seo",
      companionTableName: "comp_seo_locales",
      kind: "component",
    });
  });

  it("maps a field group from the UI-schema manifest (`components`)", () => {
    const r = resolveEntityTable({ components: [{ slug: "seo" }] }, "seo");
    expect(r?.tableName).toBe("comp_seo");
  });

  it("finds a field group when only the authored key is present", () => {
    const config = {
      collections: [{ slug: "pages" }],
      fieldGroups: [{ slug: "seo-meta" }],
    };
    expect(resolveEntityTable(config, "seo-meta")?.tableName).toBe(
      "comp_seo_meta"
    );
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
    expect(
      resolveEntityTable({ collections: [{ slug: "pages" }] }, "nope")
    ).toBeNull();
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
