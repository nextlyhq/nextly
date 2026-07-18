import { describe, it, expect } from "vitest";

import { getCoreSchema, CORE_TABLE_NAMES } from "../index";

describe("nextly_versions registration", () => {
  it("is listed in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_versions");
  });

  it("is present in the core schema snapshot for every dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names).toContain("nextly_versions");
    }
  });
});
