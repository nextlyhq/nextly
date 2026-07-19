import { describe, it, expect } from "vitest";

import { buildDesiredTableFromFields } from "../build-from-fields";

describe("buildDesiredTableFromFields — localized collections", () => {
  it("omits localized fields (and a localized title) from the main table", () => {
    const spec = buildDesiredTableFromFields(
      "dc_pages",
      [
        { name: "title", type: "text", localized: true },
        { name: "price", type: "number" },
        { name: "body", type: "richText", localized: true },
      ],
      "postgresql",
      { localized: true }
    );
    const names = spec.columns.map(c => c.name);
    expect(names).toContain("price");
    expect(names).toContain("id"); // system id still present
    expect(names).not.toContain("body");
    expect(names).not.toContain("title");
    // no leftover unique/index for a localized field
    expect(spec.indexes.some(i => i.columns.includes("body"))).toBe(false);
  });

  it("keeps all fields when the collection is not localized", () => {
    const spec = buildDesiredTableFromFields(
      "dc_pages",
      [
        { name: "title", type: "text", localized: true },
        { name: "price", type: "number" },
      ],
      "postgresql",
      { localized: false }
    );
    const names = spec.columns.map(c => c.name);
    expect(names).toContain("title");
    expect(names).toContain("price");
  });
});
