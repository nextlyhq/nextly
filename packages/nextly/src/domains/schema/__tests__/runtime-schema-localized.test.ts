import { getColumns } from "drizzle-orm";
import { beforeAll, describe, it, expect } from "vitest";

import { generateRuntimeSchema } from "../services/runtime-schema-generator";
import { loadDialectTables } from "../../../database/dialect-tables";

// Each dialect's builders, which this file reaches; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
});

describe("generateRuntimeSchema — localized collections", () => {
  it("omits localized fields from the main runtime table", () => {
    const { table } = generateRuntimeSchema(
      "dc_pages",
      [
        { name: "title", type: "text", localized: true },
        { name: "price", type: "number" },
      ] as never,
      "postgresql",
      { localized: true }
    );
    const cols = getColumns(table as never);
    expect(cols).toHaveProperty("price");
    expect(cols).toHaveProperty("id");
    expect(cols).not.toHaveProperty("title");
  });

  it("keeps localized fields when the collection is not localized", () => {
    const { table } = generateRuntimeSchema(
      "dc_pages",
      [{ name: "title", type: "text", localized: true }] as never,
      "postgresql"
    );
    expect(getColumns(table as never)).toHaveProperty("title");
  });
});
