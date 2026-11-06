/**
 * The table shows a row's translation state, in its Languages column and its
 * language filter, only to a user who may read every language's state. For
 * anyone else the rows carry no state, so every language would read as
 * missing, and a filter by it is refused.
 */
import { describe, expect, it } from "vitest";

import { toCollectionForColumns } from "../collection-for-columns";
import {
  getAvailableColumns,
  getDefaultVisibleColumns,
  type CollectionForColumns,
} from "../EntryTableColumns";

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

/**
 * A field the form hides is kept by the collection for its own reasons, and
 * set by some other control, so the list leaves it out of the columns it picks
 * by itself. A column someone names is still theirs to show.
 */
describe("a field the form hides", () => {
  const PAGES = {
    name: "pages",
    fields: [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "noHeaderFooter", type: "checkbox", admin: { hidden: true } },
      { name: "summary", type: "textarea" },
    ],
  };

  it("is never one of the columns the list picks by itself", () => {
    const table = toCollectionForColumns(PAGES, "pages", false);
    expect(table.admin?.defaultColumns).toContain("summary");
    expect(table.admin?.defaultColumns).not.toContain("noHeaderFooter");
  });

  it("is never a default column of a collection that names none", () => {
    const table: CollectionForColumns = {
      slug: "pages",
      fields: PAGES.fields as CollectionForColumns["fields"],
    };
    expect(getDefaultVisibleColumns(table)).toContain("summary");
    expect(getDefaultVisibleColumns(table)).not.toContain("noHeaderFooter");
  });

  it("shows when the collection names it as a default column", () => {
    const table = toCollectionForColumns(
      { ...PAGES, admin: { defaultColumns: ["title", "noHeaderFooter"] } },
      "pages",
      false
    );
    expect(getDefaultVisibleColumns(table)).toContain("noHeaderFooter");
  });

  it("stays on offer, so a reader who chose to show it still sees it", () => {
    const table = toCollectionForColumns(PAGES, "pages", false);
    expect(getAvailableColumns(table)).toContain("noHeaderFooter");
  });
});
