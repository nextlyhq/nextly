import { describe, expect, it } from "vitest";

import { builderAddress } from "./builder-address";

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

  it("is withheld from a field inside a group or a repeater", () => {
    expect(
      builderAddress(
        { kind: "collection", slug: "pages", documentId: "p1" },
        "sections.0.body"
      )
    ).toEqual({
      unavailable:
        "The Page Builder opens for a top-level field only. Move this field to the top level to edit it visually.",
    });
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
