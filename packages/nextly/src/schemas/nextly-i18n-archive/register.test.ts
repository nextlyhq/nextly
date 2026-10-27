import { describe, it, expect, beforeAll } from "vitest";

import { getCoreSchema, CORE_TABLE_NAMES } from "../index";
import { loadDialectTables } from "../../database/dialect-tables";

// The postgresql and mysql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

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
