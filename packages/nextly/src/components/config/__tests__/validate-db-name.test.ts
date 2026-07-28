import { describe, expect, it } from "vitest";

import { validateComponentConfig } from "../validate-component";

const base = {
  slug: "seo",
  label: { singular: "SEO" },
  fields: [{ type: "text" as const, name: "metaTitle" }],
};

// A custom dbName is stored and addressed verbatim, so a value naming storage
// this component does not own would make unrelated rows read as its instances.
describe("component dbName validation", () => {
  it("accepts a name outside framework storage", () => {
    const result = validateComponentConfig({ ...base, dbName: "seo_meta" });
    expect(result.valid).toBe(true);
  });

  it("rejects a core framework table", () => {
    const result = validateComponentConfig({
      ...base,
      dbName: "dynamic_components",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toContain("DB_NAME_RESERVED");
  });

  it("rejects another entity kind's namespace", () => {
    const result = validateComponentConfig({ ...base, dbName: "dc_posts" });
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toContain("DB_NAME_RESERVED");
  });

  it("accepts a quoted-identifier custom name", () => {
    // DDL quotes identifiers on every dialect, so a hyphenated name was always
    // legal and must keep loading after an upgrade.
    const result = validateComponentConfig({
      ...base,
      dbName: "comp_site-seo",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts the component's own canonical table name spelled out", () => {
    // Identical to the name generated when dbName is omitted, so it addresses
    // the table this component owns and must stay valid.
    const result = validateComponentConfig({ ...base, dbName: "comp_seo" });
    expect(result.valid).toBe(true);
  });

  it("accepts a custom name inside the component namespace", () => {
    // Documented as supported; only ANOTHER component's generated name aliases
    // storage that is not this component's.
    const result = validateComponentConfig({
      ...base,
      dbName: "comp_site_seo",
    });
    expect(result.valid).toBe(true);
  });

  it("leaves components without a dbName untouched", () => {
    const result = validateComponentConfig(base);
    expect(result.valid).toBe(true);
  });
});

describe("component config assertion errors", () => {
  it("throws the package's typed validation error", async () => {
    const { assertValidComponentConfig } = await import(
      "../validate-component"
    );
    const { NextlyError } = await import("../../../errors");

    expect(() =>
      assertValidComponentConfig({ ...base, dbName: "users" })
    ).toThrow(NextlyError);
  });
});

describe("reserved-storage matching is case-insensitive", () => {
  it("rejects an upper-case core table alias", () => {
    // SQLite and case-insensitive MySQL resolve this to the same table.
    const result = validateComponentConfig({
      ...base,
      dbName: "DYNAMIC_COMPONENTS",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an upper-case entity namespace alias", () => {
    const result = validateComponentConfig({ ...base, dbName: "DC_POSTS" });
    expect(result.valid).toBe(false);
  });
});

describe("companion-table shape is reserved", () => {
  it("rejects a name that would be read as a localization companion", () => {
    // `comp_*_locales` is how companions are recognised; a main table wearing
    // that shape gets pruned as an orphaned companion.
    const result = validateComponentConfig({
      ...base,
      dbName: "comp_seo_locales",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects it case-insensitively", () => {
    const result = validateComponentConfig({
      ...base,
      dbName: "COMP_SEO_LOCALES",
    });
    expect(result.valid).toBe(false);
  });
});

describe("reserved-name matching ignores surrounding whitespace", () => {
  it("rejects a padded core table name", () => {
    // MySQL discards trailing identifier spaces, so this resolves back onto
    // core storage once stored verbatim.
    const result = validateComponentConfig({
      ...base,
      dbName: "dynamic_components ",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a padded entity namespace", () => {
    const result = validateComponentConfig({ ...base, dbName: " dc_posts" });
    expect(result.valid).toBe(false);
  });
});
