import { describe, expect, it } from "vitest";

import { claimBuilderReturn, rememberBuilderReturn } from "./builder-return";

const page = { kind: "collection", slug: "pages", documentId: "p1" } as const;

describe("returning from the Page Builder to the field it was open on", () => {
  it("is found by the row's id, not by where the row now stands", () => {
    // Opened on the row whose id is `row-b`, then the rows were reordered:
    // `row-b` is now first and `row-a` stands where `row-b` stood. Each field
    // asks by its own address, which names its row's id, so the return goes
    // to `row-b`'s field and not to the one now at its old position.
    rememberBuilderReturn(page, "sections.row-b.body");

    expect(claimBuilderReturn(page, "sections.row-a.body")).toBe(false);
    expect(claimBuilderReturn(page, "sections.row-b.body")).toBe(true);
  });

  it("is taken once, so a second render does not move the focus again", () => {
    rememberBuilderReturn(page, "hero.body");

    expect(claimBuilderReturn(page, "hero.body")).toBe(true);
    expect(claimBuilderReturn(page, "hero.body")).toBe(false);
  });

  it("belongs to the document it was left from", () => {
    // The same field path on another page is not the field the author left.
    rememberBuilderReturn(page, "layout");

    expect(
      claimBuilderReturn(
        { kind: "collection", slug: "pages", documentId: "p2" },
        "layout"
      )
    ).toBe(false);
    expect(
      claimBuilderReturn({ kind: "single", slug: "pages" }, "layout")
    ).toBe(false);
    expect(claimBuilderReturn(page, "layout")).toBe(true);
  });

  it("remembers nothing outside a document", () => {
    rememberBuilderReturn(null, "layout");

    expect(claimBuilderReturn(page, "layout")).toBe(false);
  });
});
