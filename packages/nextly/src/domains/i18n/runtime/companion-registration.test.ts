import { describe, it, expect } from "vitest";

import { buildCompanionRuntimeTable } from "./companion-registration";

describe("buildCompanionRuntimeTable", () => {
  it("returns null when the entity is not localized", () => {
    const result = buildCompanionRuntimeTable({
      slug: "pages",
      tableName: "dc_pages",
      fields: [{ name: "body", type: "longText", localized: true }],
      dialect: "sqlite",
      localized: false,
    });
    expect(result).toBeNull();
  });

  it("returns null when a localized collection has no localized fields", () => {
    const result = buildCompanionRuntimeTable({
      slug: "pages",
      tableName: "dc_pages",
      fields: [{ name: "price", type: "number" }],
      dialect: "sqlite",
      localized: true,
    });
    expect(result).toBeNull();
  });

  it("builds the companion table named <tableName>_locales for a localized entity", () => {
    const result = buildCompanionRuntimeTable({
      slug: "pages",
      tableName: "dc_pages",
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ],
      dialect: "sqlite",
      localized: true,
    });
    expect(result).not.toBeNull();
    expect(result!.companionTableName).toBe("dc_pages_locales");
    expect(result!.table).toBeDefined();
  });
});
