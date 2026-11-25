// The archive records an entity SLUG, but replaying rows needs the physical `_locales` table.
// `nextly i18n:restore --collection pages` depends on this mapping being right for all three
// entity kinds, so it is pinned here.

import { describe, expect, it } from "vitest";

import { withStoredTable } from "../../field-groups/services/field-group-stored-tables";

import {
  chooseRestoreEntity,
  resolveEntityTables,
} from "./resolve-entity-table";

/** The one entity a slug names, for the cases below where it names one. */
const resolveEntityTable = (
  config: Parameters<typeof resolveEntityTables>[0],
  slug: string
) => resolveEntityTables(config, slug)[0] ?? null;

describe("resolveEntityTables", () => {
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
    expect(r?.kind).toBe("fieldGroup");
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
      kind: "fieldGroup",
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
    expect(resolveEntityTable(config, "seo")?.kind).toBe("fieldGroup");
    expect(resolveEntityTable(config, "site-settings")?.kind).toBe("single");
  });
});

describe("a slug more than one kind of entity uses", () => {
  // Collections and Singles share one namespace of slugs, but a field group's registry is its own.
  const config = {
    collections: [{ slug: "hero" }],
    fieldGroups: [{ slug: "hero" }],
  };

  it("resolves to every entity that has it", () => {
    expect(resolveEntityTables(config, "hero").map(e => e.kind)).toEqual([
      "collection",
      "fieldGroup",
    ]);
  });

  it("is refused for a restore that does not say which, naming the kinds", () => {
    expect(
      chooseRestoreEntity("hero", resolveEntityTables(config, "hero"))
    ).toEqual({
      problem:
        '"hero" names a collection and a field group. Say which with --kind collection or --kind field-group.',
    });
  });

  it("restores the kind the restore names", () => {
    expect(
      chooseRestoreEntity(
        "hero",
        resolveEntityTables(config, "hero"),
        "field-group"
      )
    ).toEqual({
      entity: {
        tableName: "comp_hero",
        companionTableName: "comp_hero_locales",
        kind: "fieldGroup",
      },
    });
  });

  it("is refused when the named kind does not have the slug", () => {
    expect(
      chooseRestoreEntity("hero", resolveEntityTables(config, "hero"), "single")
    ).toEqual({ problem: 'No single named "hero" was found.' });
  });

  it("needs no kind when one entity has the slug", () => {
    expect(
      chooseRestoreEntity(
        "hero",
        resolveEntityTables({ singles: [{ slug: "hero" }] }, "hero")
      )
    ).toEqual({
      entity: {
        tableName: "single_hero",
        companionTableName: "single_hero_locales",
        kind: "single",
      },
    });
  });

  it("is refused for an unknown kind", () => {
    expect(
      chooseRestoreEntity("hero", resolveEntityTables(config, "hero"), "page")
    ).toEqual({
      problem: '--kind must be collection, single or field-group, not "page".',
    });
  });
});

// A site on the current field-group names stores a group as fg_<slug>, which no config rule
// derives: the registry's row is what names the table a restore writes to.
describe("withStoredTable", () => {
  const stored = { tables: new Map([["hero", "fg_hero"]]), usable: true };

  it("takes a field group's tables from its stored row", () => {
    const [group] = resolveEntityTables(
      { fieldGroups: [{ slug: "hero" }] },
      "hero"
    );
    expect(group && withStoredTable(group, "hero", stored)).toEqual({
      tableName: "fg_hero",
      companionTableName: "fg_hero_locales",
      kind: "fieldGroup",
    });
  });

  // An unreadable registry says nothing about where a group is stored: the configuration's name
  // would be the legacy one, and a stale legacy table there would take the values instead.
  it("refuses a field group where the registry could not be read", () => {
    const [group] = resolveEntityTables(
      { fieldGroups: [{ slug: "hero" }] },
      "hero"
    );
    expect(() =>
      group
        ? withStoredTable(group, "hero", {
            tables: new Map(),
            usable: false,
            reason: "no answer",
          })
        : undefined
    ).toThrow(/field-group registry could not be read/);
  });

  it("keeps a collection's tables, and a group's where the registry holds no row", () => {
    const [collection] = resolveEntityTables(
      { collections: [{ slug: "hero" }] },
      "hero"
    );
    expect(collection && withStoredTable(collection, "hero", stored)).toEqual(
      collection
    );
    const [group] = resolveEntityTables(
      { fieldGroups: [{ slug: "card" }] },
      "card"
    );
    expect(group && withStoredTable(group, "card", stored)).toEqual(group);
  });
});
