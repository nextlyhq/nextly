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

  it("rejects a managed entity prefix", () => {
    const result = validateComponentConfig({ ...base, dbName: "dc_posts" });
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toContain("DB_NAME_RESERVED");
  });

  it("rejects an identifier that is not a safe table name", () => {
    const result = validateComponentConfig({ ...base, dbName: "Seo Meta!" });
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toContain("DB_NAME_INVALID_FORMAT");
  });

  it("leaves components without a dbName untouched", () => {
    const result = validateComponentConfig(base);
    expect(result.valid).toBe(true);
  });
});
