import { describe, expect, it } from "vitest";

import {
  builderAddress,
  fieldBuilderAddress,
  openAtFromSearch,
  sectionAddress,
  sectionFromSearch,
} from "./builder-address";

describe("builderAddress", () => {
  it("is the entry's builder, naming the field", () => {
    expect(
      builderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        "body"
      )
    ).toEqual({ href: "/admin/collections/pages/p1/builder?field=body" });
  });

  it("is the Single's builder, naming the field", () => {
    expect(
      builderAddress({ kind: "single", slug: "homepage" }, "layout")
    ).toEqual({ href: "/admin/singles/homepage/builder?field=layout" });
  });

  it("is withheld from an entry never saved, which has no address", () => {
    expect(
      builderAddress({ kind: "collection", slug: "pages" }, "body")
    ).toEqual({ unavailable: "Save this page to open the Page Builder." });
  });

  it("names a field inside a named group by its path", () => {
    expect(
      builderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        "hero.body"
      )
    ).toEqual({
      href: "/admin/collections/pages/p1/builder?field=hero.body",
    });
  });

  it("names a field inside a repeater's row by the row's saved id", () => {
    // The address the form gives the field (`useFieldAddress`), carried as
    // it is: the view finds the row by this id wherever the row has moved.
    expect(
      fieldBuilderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        { address: "sections.row-b.body" }
      )
    ).toEqual({
      href: "/admin/collections/pages/p1/builder?field=sections.row-b.body",
    });
  });

  it("says to save once for a row that has no saved id yet, on the same button", () => {
    // `unavailable` is drawn beneath the card's way in, which is then
    // disabled: the same control, never a different-looking one.
    expect(
      fieldBuilderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        { unavailable: "unsavedRow" }
      )
    ).toEqual({ unavailable: "Save the entry once to design this row." });
  });

  it("says why a repeater whose rows set their own id has no way in", () => {
    const address = fieldBuilderAddress(
      { kind: "collection", slug: "pages", documentId: "p1" },
      { unavailable: "ownIds" }
    );
    expect("unavailable" in address ? address.unavailable : "").toContain(
      "set their own id field"
    );
  });

  it("asks for the page to be saved first on an entry never saved, before the row", () => {
    // Every row of an unsaved entry is unsaved too; saving the page is the
    // one step that answers both.
    expect(
      fieldBuilderAddress(
        { kind: "collection", slug: "pages" },
        { unavailable: "unsavedRow" }
      )
    ).toEqual({ unavailable: "Save this page to open the Page Builder." });
  });

  it("says it opens the default language when another one is on screen", () => {
    // The builder edits the default language only, so a link followed from the
    // Spanish edit screen opens the default one, and the card has to say so
    // beside a preview that is showing the Spanish page.
    expect(
      builderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        "body",
        { documentLocalized: true, isDefaultLocale: false }
      )
    ).toEqual({
      href: "/admin/collections/pages/p1/builder?field=body",
      note: "Opens the default language, the one the Page Builder edits.",
    });
  });

  it.each([
    [
      "the default language",
      { documentLocalized: true, isDefaultLocale: true },
    ],
    [
      "a document that is not localized",
      { documentLocalized: false, isDefaultLocale: false },
    ],
  ])("says nothing about language on %s", (_case, locale) => {
    expect(
      builderAddress({ kind: "single", slug: "homepage" }, "layout", locale)
    ).toEqual({ href: "/admin/singles/homepage/builder?field=layout" });
  });

  it("is withheld outside a document", () => {
    expect(builderAddress(null, "body")).toEqual({
      unavailable: "The Page Builder opens from a saved page.",
    });
  });

  it("encodes the parts it puts in the address", () => {
    expect(
      builderAddress(
        { kind: "collection", slug: "pages", documentId: "a/b c" },
        "body"
      )
    ).toEqual({
      href: "/admin/collections/pages/a%2Fb%20c/builder?field=body",
    });
  });
});

describe("sectionAddress", () => {
  it("names the section after the field, so the address still opens that field", () => {
    expect(
      sectionAddress("/admin/collections/pages/p1/builder?field=body", "hero")
    ).toBe("/admin/collections/pages/p1/builder?field=body&section=hero");
  });

  it("encodes an id the query would otherwise split or end", () => {
    const href = sectionAddress(
      "/admin/singles/home/builder?field=layout",
      "a&b=c#d"
    );
    expect(sectionFromSearch(new URL(href, "http://x").search)).toBe("a&b=c#d");
  });

  it("replaces a section already named rather than naming two", () => {
    expect(
      sectionAddress(
        "/admin/collections/pages/p1/builder?field=body&section=old",
        "new"
      )
    ).toBe("/admin/collections/pages/p1/builder?field=body&section=new");
  });
});

describe("sectionFromSearch", () => {
  it("reads the section the address names", () => {
    expect(sectionFromSearch("?field=body&section=hero")).toBe("hero");
  });

  it("reads none from an address that names none, or names it empty", () => {
    expect(sectionFromSearch("?field=body")).toBeUndefined();
    expect(sectionFromSearch("?field=body&section=")).toBeUndefined();
    expect(sectionFromSearch("")).toBeUndefined();
  });
});

describe("openAtFromSearch", () => {
  it("opens at the section an address names, before any block", () => {
    expect(openAtFromSearch("?section=plans&block=nested")).toEqual({
      sectionId: "plans",
    });
  });

  it("opens at a block when the address names no section", () => {
    expect(openAtFromSearch("?block=nested")).toEqual({ blockId: "nested" });
  });

  it("opens at neither when the address names neither, or names them empty", () => {
    expect(openAtFromSearch("")).toEqual({});
    expect(openAtFromSearch("?section=&block=")).toEqual({});
  });
});
