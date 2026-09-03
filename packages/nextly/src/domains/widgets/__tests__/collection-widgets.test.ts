/**
 * A card per collection: what is derived, and what is deliberately not.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  collectionWidgets,
  generatedCollectionSlug,
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

  it("carries NO requiredPermission, because the SERVER gates it", () => {
    // 🔴 It used to carry the source's permission, and that was wrong in the
    // direction that loses cards. The client checks `requiredPermission` against
    // the flat `/me/permissions` list, which does not hold a grant that exists
    // only in a collection's code-defined `access.read` — so a reader the server
    // had approved saw both cards discarded by the grid, for a query it would
    // have answered. The server filters these by collection on both paths that
    // publish them; the client draws what it is sent.
    const widgets = collectionWidgets([
      source({ requiredPermission: "read-articles" }),
    ]);
    expect(widgets).toHaveLength(2);
    for (const widget of widgets) {
      expect(widget).not.toHaveProperty("requiredPermission");
    }
  });

  it("derives a valid id for a slug carrying an underscore", () => {
    // 🔴 `SLUG_PATTERN` permits `_` and a widget id does not, so
    // `customer_notes` produced an id the registry refuses and BOTH cards were
    // dropped — a supported class of collection that never got the feature.
    const widgets = collectionWidgets([
      source({ id: "collection:customer_notes", label: "customer_notes" }),
    ]);
    expect(widgets.map(w => w.id)).toEqual([
      "collection/customer-notes-count",
      "collection/customer-notes-recent",
    ]);
  });

  it("gives NEITHER collection a card when two slugs derive one id", () => {
    // The mapping is not injective: `a_b` and `a-b` both reduce to `a-b`.
    // Neither has a claim over the other, and a card drawn for one while its
    // query reads the other is the worst outcome available — so a collision
    // costs both rather than silently picking a winner.
    const widgets = collectionWidgets([
      source({ id: "collection:a_b", label: "a_b" }),
      source({ id: "collection:a-b", label: "a-b" }),
    ]);
    expect(widgets).toEqual([]);
  });

  it("still gives a card to collections that did not collide", () => {
    // The control: without it the assertion above is satisfied by a collision
    // rule that drops everything.
    const widgets = collectionWidgets([
      source({ id: "collection:a_b", label: "a_b" }),
      source({ id: "collection:a-b", label: "a-b" }),
      source({ id: "collection:posts", label: "posts" }),
    ]);
    expect(widgets.map(w => w.id)).toEqual([
      "collection/posts-count",
      "collection/posts-recent",
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
      slug => slug !== "secret",
      new Set()
    );

    expect(readable.map(w => w.id)).toEqual(["open"]);
  });

  it("withholds a card whose id a DECLARATION already claimed", () => {
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

describe("which collection a generated card is about", () => {
  it("takes it from the QUERY, not from the widget id", () => {
    // 🔴 Access is checked against the thing being READ. The id is a display
    // identity that happens to be derived from the same slug; checking a name
    // rather than the source is how the two come apart, and the query is what
    // the read is actually performed against.
    expect(
      generatedCollectionSlug({
        id: "collection/anything-count",
        query: { source: "collection:posts", op: "count" },
      } as unknown as Parameters<typeof generatedCollectionSlug>[0])
    ).toBe("posts");
  });

  it("names nothing for a card that queries no collection", () => {
    // The control, and what makes the refusal in `readableGeneratedWidgets`
    // meaningful: a card whose subject cannot be identified is withheld.
    expect(
      generatedCollectionSlug({
        id: "core/whatever",
        query: { source: "system:users", op: "count" },
      } as unknown as Parameters<typeof generatedCollectionSlug>[0])
    ).toBeUndefined();
  });
});
