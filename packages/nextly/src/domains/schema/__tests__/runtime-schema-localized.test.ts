import { getTableColumns } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { generateRuntimeSchema } from "../services/runtime-schema-generator";

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
    const cols = getTableColumns(table as never);
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
    expect(getTableColumns(table as never)).toHaveProperty("title");
  });
});
