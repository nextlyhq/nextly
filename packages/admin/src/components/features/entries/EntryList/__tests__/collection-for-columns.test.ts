/**
 * The table shows a row's translation state, in its Languages column and its
 * language filter, only to a user who may read every language's state. For
 * anyone else the rows carry no state, so every language would read as
 * missing, and a filter by it is refused.
 */
import { describe, expect, it } from "vitest";

import { toCollectionForColumns } from "../collection-for-columns";
import { getAvailableColumns } from "../EntryTableColumns";

const LOCALIZED = {
  name: "posts",
  fields: [{ name: "title", type: "text" }],
  localized: true,
};

describe("toCollectionForColumns", () => {
  it("shows a localized collection's translation state to a user who may read it", () => {
    const table = toCollectionForColumns(LOCALIZED, "posts", true);
    expect(table.localized).toBe(true);
    expect(getAvailableColumns(table)).toContain("translations");
  });

  it("shows no translation state to a user who may not read every language's", () => {
    const table = toCollectionForColumns(LOCALIZED, "posts", false);
    expect(table.localized).toBe(false);
    expect(getAvailableColumns(table)).not.toContain("translations");
  });

  it("shows none on a collection with one language, whoever reads it", () => {
    const table = toCollectionForColumns(
      { ...LOCALIZED, localized: false },
      "posts",
      true
    );
    expect(table.localized).toBe(false);
  });
});
