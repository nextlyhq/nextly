/**
 * A card per collection: what is derived, and what is deliberately not.
 */
import { describe, expect, it } from "vitest";

import { collectionWidgets } from "../collection-widgets";
import type { WidgetSource } from "../sources";

function source(patch: Partial<WidgetSource>): WidgetSource {
  return {
    id: "collection:posts",
    label: "posts",
    kind: "collection",
    requiredPermission: "read-posts",
    supports: ["count", "list"],
    fields: [
      { name: "id", type: "string" },
      { name: "title", type: "string" },
      { name: "updatedAt", type: "date" },
    ],
    ...patch,
  } as WidgetSource;
}

describe("what a collection gets", () => {
  it("derives a metric and a list from one source", () => {
    const widgets = collectionWidgets([source({})]);
    expect(widgets.map(w => [w.id, w.archetype])).toEqual([
      ["collection/posts-count", "metric"],
      ["collection/posts-recent", "list"],
    ]);
  });

  it("takes the permission from the SOURCE rather than rebuilding it", () => {
    // 🔴 The widget and the source must agree about which permission gates the
    // collection. Rebuilding `read-${slug}` here would be a second answer, and
    // a source whose permission was corrected would leave a card gated by the
    // old one -- offered to a reader whose every query against it is refused.
    const widgets = collectionWidgets([
      source({ requiredPermission: "read-articles" }),
    ]);
    expect(widgets.map(w => w.requiredPermission)).toEqual([
      "read-articles",
      "read-articles",
    ]);
  });

  it("counts EVERY entry, drafts included", () => {
    // A count that quietly excluded drafts would disagree with the number the
    // collection's own list view shows, with nothing to say which is narrower.
    const [count] = collectionWidgets([source({})]);
    expect(count.query).toMatchObject({ op: "count", status: "all" });
  });

  it("selects the row label first and the muted line second", () => {
    // The order the `list` renderer reads `select` in.
    const [, recent] = collectionWidgets([source({})]);
    expect(recent.query?.select).toEqual(["title", "updatedAt"]);
    expect(recent.query?.sort).toBe("-updatedAt");
  });

  it("honours the conventional title order rather than field order", () => {
    const [, recent] = collectionWidgets([
      source({
        fields: [
          { name: "heading", type: "string" },
          { name: "title", type: "string" },
          { name: "updatedAt", type: "date" },
        ],
      }),
    ]);
    expect(recent.query?.select?.[0]).toBe("title");
  });
});

describe("what a collection does NOT get", () => {
  it("no list when nothing names its entries", () => {
    // 🔴 A refusal, not a fallback. Every row would read as an identifier, and
    // the `list` renderer already declines to guess a key out of a document it
    // knows nothing about -- generating one that guesses badly would defeat
    // that by answering the question wrongly instead of declining it.
    const widgets = collectionWidgets([
      source({
        fields: [
          { name: "id", type: "string" },
          { name: "amount", type: "number" },
          { name: "updatedAt", type: "date" },
        ],
      }),
    ]);
    expect(widgets.map(w => w.archetype)).toEqual(["metric"]);
  });

  it("no list when there is no updatedAt to mean 'recent'", () => {
    // Sorting by id would give a card whose title claims something its rows do
    // not support.
    const widgets = collectionWidgets([
      source({
        fields: [
          { name: "id", type: "string" },
          { name: "title", type: "string" },
        ],
      }),
    ]);
    expect(widgets.map(w => w.archetype)).toEqual(["metric"]);
  });

  it("no metric when the source does not answer count", () => {
    const widgets = collectionWidgets([source({ supports: ["list"] })]);
    expect(widgets.map(w => w.archetype)).toEqual(["list"]);
  });

  it("nothing at all for a source that is not a collection", () => {
    // Singles hold one entry, so a count of them is a constant and a list of
    // them is that one entry. Neither is a card worth offering.
    expect(
      collectionWidgets([
        source({ id: "single:homepage", kind: "single", label: "homepage" }),
      ])
    ).toEqual([]);
  });

  it("nothing when the install has no sources", () => {
    expect(collectionWidgets([])).toEqual([]);
  });

  it("no card at all when the slug cannot make a valid widget id", () => {
    // 🔴 A widget id is `namespace/name` in lowercase slug form, and the check
    // is the REGISTRY's own predicate rather than a copy of its pattern. A
    // second copy would accept ids the registry refuses -- and these ids reach
    // the admin's payload and the layout endpoint, both of which treat them as
    // real. Skipping is the honest outcome: the collection is still readable
    // everywhere else, it simply gets no generated card.
    expect(
      collectionWidgets([
        source({ id: "collection:Weird_Slug", label: "Weird_Slug" }),
      ])
    ).toEqual([]);
  });
});
