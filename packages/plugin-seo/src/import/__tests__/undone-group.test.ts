/**
 * What putting back a step of an import writes: each place that still holds
 * what the import wrote goes back to what it held before, over the group as
 * stored now, so a value someone saved since, in another place or the same
 * one, is never undone, and a place the write left out is left as it is.
 */
import { describe, expect, it } from "vitest";

import { undoneGroup, type PlannedPage } from "../plan";

/** A version the import wrote `writes` into, over `seo` as it was stored. */
function planned(
  seo: Record<string, unknown>,
  writes: Record<string, unknown>
): PlannedPage {
  return {
    type: "pages",
    id: "about",
    label: "About",
    key: "pages|about|de|published",
    locale: "de",
    form: "published",
    write: "inPlace",
    inTransaction: false,
    writes,
    seo,
    places: ["title", "description"],
    same: [],
    kept: [],
    neverServed: [],
    values: {},
  };
}

const stored = (seo: Record<string, unknown>) => ({ id: "about", seo });

describe("putting back a step of an import", () => {
  it("keeps a value someone saved in another place since", () => {
    const page = planned({ noindex: false }, { metaTitle: "Imported title" });
    expect(
      undoneGroup(
        stored({
          noindex: false,
          metaTitle: "Imported title",
          metaDescription: "Typed since by an editor",
        }),
        page
      )
    ).toEqual({
      noindex: false,
      metaTitle: null,
      metaDescription: "Typed since by an editor",
    });
  });

  it("puts back a place the write kept, and leaves one it left out", () => {
    const page = planned(
      { metaDescription: "Before" },
      { metaTitle: "Imported title", metaDescription: "Imported description" }
    );
    // A field rule kept the description as it was.
    expect(
      undoneGroup(
        stored({ metaTitle: "Imported title", metaDescription: "Before" }),
        page
      )
    ).toEqual({ metaTitle: null, metaDescription: "Before" });
  });

  it("writes nothing where no place holds the import's value any more", () => {
    const page = planned({}, { metaTitle: "Imported title" });
    expect(
      undoneGroup(stored({ metaTitle: "Changed since" }), page)
    ).toBeUndefined();
  });

  it("compares a share image by its id", () => {
    const page = planned({}, { ogImage: "img-1" });
    expect(
      undoneGroup(stored({ ogImage: { id: "img-1", url: "/a.png" } }), page)
    ).toEqual({ ogImage: null });
  });
});
