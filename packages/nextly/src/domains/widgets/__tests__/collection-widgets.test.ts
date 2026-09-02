/**
 * A card per collection: what is derived, and what is deliberately not.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  collectionWidgets,
  readableGeneratedWidgets,
  setGeneratedWidgets,
} from "../collection-widgets";
import type { WidgetSource } from "../sources";

function source(patch: Partial<WidgetSource>): WidgetSource {
  return {
    id: "collection:posts",
    label: "posts",
    kind: "collection",
    requiredPermission: "read-posts",
    titleField: "title",
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

  it("labels rows with the field the SOURCE resolved, not one of its own", () => {
    // 🔴 The source already applied the shared rule to the author's
    // `admin.useAsTitle` AND the full field list. Re-resolving here from
    // `fields` alone would ignore the nomination: a collection whose author
    // chose `headline` would be labelled by a conventional name instead, and
    // the dashboard would hold the worse of two answers to one question.
    const [, recent] = collectionWidgets([
      source({
        titleField: "headline",
        fields: [
          { name: "headline", type: "string" },
          { name: "title", type: "string" },
          { name: "updatedAt", type: "date" },
        ],
      }),
    ]);
    expect(recent.query?.select?.[0]).toBe("headline");
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
        titleField: undefined,
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

describe("which generated cards a reader may be told about", () => {
  const card = (id: string, permission?: string) =>
    ({
      id,
      title: id,
      archetype: "metric",
      defaultSize: "sm",
      ...(permission === undefined ? {} : { requiredPermission: permission }),
      query: { source: `collection:${id}`, op: "count" },
    }) as unknown as Parameters<typeof setGeneratedWidgets>[0][number];

  afterEach(() => setGeneratedWidgets([]));

  it("withholds a card for a collection this reader may not read", () => {
    // 🔴 The disclosure. A generated card's id, title and query all name a
    // COLLECTION, so publishing the whole set tells any authenticated reader
    // the slug and the existence of every collection in the install --
    // including the ones the layout and query endpoints hide from them. That
    // the admin would not draw the card is not a control: the payload is JSON,
    // and reading it is the bypass.
    setGeneratedWidgets([card("secret", "read-secret"), card("open")]);

    const readable = readableGeneratedWidgets(
      permission => permission !== "read-secret",
      new Set()
    );

    expect(readable.map(w => w.id)).toEqual(["open"]);
  });

  it("withholds a card whose id a CONTRIBUTION already claimed", () => {
    // The admin reads this array as the registration channel, and its merge
    // gives a registration authority over a colliding contribution's title,
    // archetype, query and permission. Publishing here would replace a plugin's
    // card with core's guess in the grid while the server's canonical set kept
    // the plugin's -- drawing one declaration and placing another.
    setGeneratedWidgets([card("posts"), card("pages")]);

    const readable = readableGeneratedWidgets(() => true, new Set(["posts"]));

    expect(readable.map(w => w.id)).toEqual(["pages"]);
  });

  it("passes everything a reader may see and nobody claimed", () => {
    // The control. Without it both refusals above are satisfied by a filter
    // that returns nothing at all.
    setGeneratedWidgets([card("posts"), card("pages")]);
    expect(
      readableGeneratedWidgets(() => true, new Set()).map(w => w.id)
    ).toEqual(["posts", "pages"]);
  });
});
