/**
 *
 * Pins the contract that `createdAt` AND `updatedAt` both ship in the
 * default-visible column set. Pre-PR-4 the default included only
 * `updatedAt`; users had to open the column toggler to see Created.
 * Per item 6 of 07-admin-bugs-feedback, both timestamps are first-class
 * metadata and should be visible without extra clicks.
 */
import { describe, expect, it } from "vitest";

import {
  getAvailableColumns,
  getDefaultVisibleColumns,
  type CollectionForColumns,
} from "../EntryTableColumns";

const baseCollection: CollectionForColumns = {
  slug: "posts",
  fields: [
    { type: "text", name: "title", label: "Title" } as never,
    { type: "text", name: "slug", label: "Slug" } as never,
    { type: "textarea", name: "body", label: "Body" } as never,
  ],
};

describe("EntryTableColumns timestamp defaults", () => {
  it("getAvailableColumns includes createdAt + updatedAt", () => {
    const cols = getAvailableColumns(baseCollection);
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("getDefaultVisibleColumns includes BOTH createdAt and updatedAt", () => {
    const cols = getDefaultVisibleColumns(baseCollection);
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("createdAt comes before updatedAt in the default visible order", () => {
    const cols = getDefaultVisibleColumns(baseCollection);
    expect(cols.indexOf("createdAt")).toBeLessThan(cols.indexOf("updatedAt"));
  });

  it("structural columns (select, actions) bookend the data columns", () => {
    const cols = getDefaultVisibleColumns(baseCollection);
    expect(cols[0]).toBe("select");
    expect(cols[cols.length - 1]).toBe("actions");
  });

  it("admin.defaultColumns override is honoured but createdAt/updatedAt still added", () => {
    // Why: when the collection author specifies a custom defaultColumns
    // list, the explicit columns ship first; createdAt/updatedAt are
    // appended via the timestamp-injection branch in
    // getDefaultVisibleColumns. This locks that behaviour so a custom
    // override doesn't accidentally drop both timestamps.
    const cols = getDefaultVisibleColumns({
      ...baseCollection,
      admin: { defaultColumns: ["title", "slug"] },
    });
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });
});
