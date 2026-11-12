/**
 * Which document the SEO tab asks about: a saved entry and a Single by their
 * ids, since the address the resolver records is judged against the document
 * that holds it, and a new entry by none.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentLocale: () => undefined,
}));

import { documentKeyOf, documentOf, withValueAt } from "../tab-document";

describe("the document the tab asks about", () => {
  it("names a saved entry by its id", () => {
    expect(
      documentOf(
        { userId: "u1", collection: "posts", entryId: "p1" },
        undefined,
        "en"
      )
    ).toEqual({ kind: "collection", slug: "posts", locale: "en", id: "p1" });
  });

  it("names an entry being created by no id", () => {
    expect(
      documentOf({ userId: "u1", collection: "posts", entryId: null }, {}, null)
    ).toEqual({ kind: "collection", slug: "posts", locale: null, id: null });
  });

  it("names a saved Single by the id it was read with", () => {
    expect(
      documentOf({ userId: "u1", single: "home" }, { id: "s1" }, null)
    ).toEqual({ kind: "single", slug: "home", locale: null, id: "s1" });
  });

  it("names a Single not read yet by no id", () => {
    expect(
      documentOf({ userId: "u1", single: "home" }, undefined, null)
    ).toEqual({ kind: "single", slug: "home", locale: null, id: null });
  });

  it("keys two Singles' documents apart by their ids and languages", () => {
    const one = documentKeyOf({
      kind: "single",
      slug: "home",
      locale: "en",
      id: "s1",
    });
    expect(one).not.toBe(
      documentKeyOf({ kind: "single", slug: "home", locale: "fr", id: "s1" })
    );
    expect(one).not.toBe(
      documentKeyOf({ kind: "single", slug: "home", locale: "en", id: "s2" })
    );
  });
});

describe("the document as typed, with a value the form does not hold yet", () => {
  it("puts the value at its path, top-level or nested, leaving the form's own untouched", () => {
    const typed = { title: "About", layout: { hero: "old" } };
    expect(withValueAt(typed, "content", { nodes: [1] })).toEqual({
      title: "About",
      layout: { hero: "old" },
      content: { nodes: [1] },
    });
    expect(withValueAt(typed, "layout.hero", "new")).toEqual({
      title: "About",
      layout: { hero: "new" },
    });
    expect(typed.layout.hero).toBe("old");
  });

  it("puts it in a row of a list by its index", () => {
    const typed = { rows: [{ blocks: "a" }, { blocks: "b" }] };
    expect(withValueAt(typed, "rows.1.blocks", "c")).toEqual({
      rows: [{ blocks: "a" }, { blocks: "c" }],
    });
  });
});
