import { getTableName, getTableColumns } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { generateCompanionRuntimeSchema } from "../services/runtime-schema-generator";

describe("generateCompanionRuntimeSchema", () => {
  it("produces a companion table with _parent, _locale + localized cols", () => {
    const { table } = generateCompanionRuntimeSchema(
      "dc_pages_locales",
      [
        { name: "title", kind: "text" },
        { name: "body", kind: "longText" },
      ],
      "postgresql",
      { status: false }
    );
    expect(getTableName(table)).toBe("dc_pages_locales");
    const cols = getTableColumns(table);
    expect(cols).toHaveProperty("_parent");
    expect(cols).toHaveProperty("_locale");
    expect(cols).toHaveProperty("title");
    expect(cols).toHaveProperty("body");
    expect(cols).not.toHaveProperty("_status");
  });

  it("adds _status when status is enabled", () => {
    const { table } = generateCompanionRuntimeSchema(
      "dc_pages_locales",
      [{ name: "title", kind: "text" }],
      "sqlite",
      { status: true }
    );
    expect(getTableColumns(table)).toHaveProperty("_status");
  });

  it("works across dialects", () => {
    for (const d of ["postgresql", "mysql", "sqlite"] as const) {
      const { table } = generateCompanionRuntimeSchema(
        "single_home_locales",
        [{ name: "title", kind: "text" }],
        d
      );
      expect(getTableName(table)).toBe("single_home_locales");
    }
  });
});
