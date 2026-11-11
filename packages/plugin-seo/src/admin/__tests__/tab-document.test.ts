/**
 * Which document the SEO tab asks about: a saved entry and a Single by their
 * ids, since the address the resolver records is judged against the document
 * that holds it, and a new entry by none.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentLocale: () => undefined,
}));

import { documentKeyOf, documentOf } from "../tab-document";

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
