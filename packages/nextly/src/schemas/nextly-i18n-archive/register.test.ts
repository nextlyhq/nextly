import { describe, it, expect } from "vitest";

import { getCoreSchema, CORE_TABLE_NAMES } from "../index";

describe("nextly_i18n_archive registration", () => {
  it("is listed in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_i18n_archive");
  });

  it("is present in the core schema for every dialect", () => {
    for (const d of ["postgresql", "mysql", "sqlite"] as const) {
      const names = getCoreSchema(d).tables.map(t => t.name);
      expect(names).toContain("nextly_i18n_archive");
    }
  });
});
