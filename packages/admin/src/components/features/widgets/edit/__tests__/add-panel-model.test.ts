/**
 * What the add gallery lists from the server's read and the reader's draft: what each tile does,
 * what a chip and a search keep (a collection's pairs among them), which suggestions the draft
 * still has room for, and what the add step starts with.
 */
import { sizeBounds } from "nextly/config";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import {
  addWidths,
  collectionsFor,
  type CanAsk,
  galleryCount,
  galleryTiles,
  newCardSettings,
  periodOf,
  removedCards,
  searchGallery,
  startingCollection,
  suggestionsFor,
  tilesInChip,
  widthsLabel,
  type GalleryRead,
  type GalleryTile,
} from "../add-panel-model";

const tile = (over: Partial<GalleryTile> & { id: string }): GalleryTile => ({
  name: over.id,
  size: sizeBounds({ default: { w: 4, h: 3 } }),
  allowsSeveral: false,
  ...over,
});

const COUNT = tile({
  id: "core/count",
  name: "Count",
  description: "How many entries a collection holds.",
  category: "content",
  collectionSetting: "collection",
  allowsSeveral: true,
});
const TEAM = tile({ id: "core/team", name: "Team", category: "activity" });
const SEO = tile({
  id: "seo/score",
  name: "SEO score",
  category: "plugins",
  declaredCategory: "Marketing",
});

const READ: GalleryRead = {
  tiles: [COUNT, TEAM, SEO],
  collections: [
    { slug: "posts", label: "Posts", lifecycle: true, entries: 3 },
    { slug: "pages", label: "Pages", lifecycle: false, entries: 9 },
  ],
  mostEdited: "pages",
  suggested: [
    { widgetId: "core/count", collection: "posts", label: "Posts count" },
    { widgetId: "core/team", collection: "posts", label: "not a pair" },
  ],
};

/** The widgets this admin can draw, each titled as the dashboard titles its card. */
const drawn = (id: string, title: string): [string, DashboardWidget] => [
  id,
  {
    id,
    title,
    archetype: "custom",
    size: sizeBounds({ default: { w: 4, h: 3 } }),
  },
];
const BY_ID = new Map<string, DashboardWidget>([
  drawn("core/count", "Count"),
  drawn("core/team", "Team"),
  drawn("seo/score", "SEO score"),
  drawn("core/single", "Single"),
]);

const card = (over: Partial<WidgetPlacement>): WidgetPlacement => ({
  id: "p1",
  widgetId: "core/team",
  w: 4,
  h: 3,
  removed: false,
  ...over,
});

describe("galleryTiles", () => {
  it("offers Add, then Add another for a widget that allows several", () => {
    const [count] = galleryTiles(
      READ,
      [card({ widgetId: "core/count", config: { collection: "posts" } })],
      BY_ID
    );
    expect(count.action).toEqual({ kind: "add-another" });
    expect(count.placed).toBe(1);
    expect(galleryTiles(READ, [], BY_ID)[0].action).toEqual({ kind: "add" });
  });

  it("says a one-card widget the draft holds is on the dashboard", () => {
    const team = galleryTiles(READ, [card({})], BY_ID).find(
      view => view.tile.id === "core/team"
    );
    expect(team?.action).toEqual({ kind: "on-dashboard" });
  });

  it("has no tile for a one-card widget removed this session: its card comes back from Removed", () => {
    const ids = galleryTiles(READ, [card({ removed: true })], BY_ID).map(
      view => view.tile.id
    );
    expect(ids).toEqual(["core/count", "seo/score"]);
  });

  it("names each tile as the dashboard titles its card, never by its id", () => {
    const named = galleryTiles(
      { tiles: [tile({ id: "acme/open-orders", name: "acme/open-orders" })] },
      [],
      new Map([drawn("acme/open-orders", "Open orders")])
    );
    expect(named.map(view => view.tile.name)).toEqual(["Open orders"]);
  });

  it("has no tile for a widget this admin cannot draw", () => {
    const ids = galleryTiles(
      READ,
      [],
      new Map([...BY_ID].filter(([id]) => id !== "seo/score"))
    ).map(view => view.tile.id);
    expect(ids).toEqual(["core/count", "core/team"]);
  });

  it("counts a removed card of a several-card widget as not placed", () => {
    const [count] = galleryTiles(
      READ,
      [card({ widgetId: "core/count", removed: true })],
      BY_ID
    );
    expect(count.action).toEqual({ kind: "add" });
  });
});

describe("collections a widget can be set to (canAsk)", () => {
  // Count can ask Posts alone.
  const canAsk: CanAsk = (widgetId, slug) =>
    widgetId !== "core/count" || slug === "posts";

  it("keeps only the collections the widget can ask", () => {
    expect(
      collectionsFor("core/count", READ.collections, canAsk).map(c => c.slug)
    ).toEqual(["posts"]);
  });

  it("starts on the most-edited collection only when the widget can ask it", () => {
    const own = collectionsFor("core/count", READ.collections, canAsk);
    // Pages is most edited, but Count cannot ask it.
    expect(startingCollection(READ, own)).toBe("posts");
    expect(startingCollection(READ, [])).toBeUndefined();
  });

  it("says a widget no readable collection suits cannot be added", () => {
    const [count] = galleryTiles(READ, [], BY_ID, () => false);
    expect(count?.action).toEqual({ kind: "no-collection" });
    // A widget that reads no collection is untouched by it.
    expect(
      galleryTiles(READ, [], BY_ID, () => false).find(
        view => view.tile.id === "core/team"
      )?.action
    ).toEqual({ kind: "add" });
  });

  it("pairs a collection only with the widgets that can ask it", () => {
    const found = searchGallery(
      {
        removed: [],
        tiles: galleryTiles(READ, [], BY_ID, canAsk),
        collections: READ.collections,
        canAsk,
      },
      "pages"
    );
    expect(found.pairs).toEqual([]);
  });

  it("suggests no pair the widget cannot ask", () => {
    const views = galleryTiles(READ, [], BY_ID, canAsk);
    expect(
      suggestionsFor(
        {
          suggested: [
            { widgetId: "core/count", collection: "pages", label: "x" },
          ],
        },
        views,
        [],
        canAsk
      )
    ).toEqual([]);
  });
});

describe("removedCards", () => {
  it("lists the draft's removed cards this admin can draw, in the draft's order", () => {
    const byId = new Map<string, DashboardWidget>([
      [
        "core/team",
        {
          id: "core/team",
          title: "Team",
          archetype: "custom",
          size: sizeBounds({ default: { w: 4, h: 3 } }),
        },
      ],
    ]);
    expect(
      removedCards(
        [
          card({ id: "a", removed: true }),
          card({ id: "b" }),
          card({ id: "c", widgetId: "gone/widget", removed: true }),
        ],
        byId
      )
    ).toEqual([{ placementId: "a", widgetId: "core/team", title: "Team" }]);
  });
});

describe("tilesInChip", () => {
  const views = galleryTiles(READ, [], BY_ID);
  it("keeps every tile under All, and a chip's own under the chip", () => {
    expect(tilesInChip(views, "all")).toHaveLength(3);
    expect(tilesInChip(views, "plugins").map(v => v.tile.id)).toEqual([
      "seo/score",
    ]);
    expect(tilesInChip(views, "trends")).toEqual([]);
  });
});

describe("searchGallery", () => {
  const input = {
    removed: [{ placementId: "r", widgetId: "core/team", title: "Team" }],
    tiles: galleryTiles(READ, [], BY_ID),
    collections: READ.collections,
  };

  it("keeps everything and lists no pairs for an empty query", () => {
    const found = searchGallery(input, "  ");
    expect(found.tiles).toHaveLength(3);
    expect(found.removed).toHaveLength(1);
    expect(found.pairs).toEqual([]);
  });

  it("matches a name, a description, a declared category and a chip's label, ignoring case", () => {
    expect(searchGallery(input, "COUNT").tiles.map(v => v.tile.id)).toEqual([
      "core/count",
    ]);
    expect(searchGallery(input, "entries a").tiles.map(v => v.tile.id)).toEqual(
      ["core/count"]
    );
    expect(searchGallery(input, "market").tiles.map(v => v.tile.id)).toEqual([
      "seo/score",
    ]);
    expect(searchGallery(input, "activity").tiles.map(v => v.tile.id)).toEqual([
      "core/team",
    ]);
  });

  it("lists each collection a query names as pairs with every widget that reads one", () => {
    const found = searchGallery(input, "pos");
    expect(found.tiles).toEqual([]);
    expect(found.pairs.map(pair => [pair.label, pair.collection.slug])).toEqual(
      [["Count · Posts", "posts"]]
    );
  });

  it("pairs no widget the draft holds its one card of", () => {
    const oneCard = tile({
      id: "core/single",
      name: "Single",
      collectionSetting: "collection",
    });
    const found = searchGallery(
      {
        ...input,
        tiles: galleryTiles(
          { tiles: [oneCard] },
          [card({ widgetId: "core/single" })],
          BY_ID
        ),
      },
      "posts"
    );
    expect(found.pairs).toEqual([]);
  });

  it("finds a removed card by its title", () => {
    expect(searchGallery(input, "tea").removed).toHaveLength(1);
  });
});

describe("galleryCount", () => {
  it("says the widgets with no query, and the results for one", () => {
    expect(galleryCount(1, "")).toBe("1 widget");
    expect(galleryCount(3, "")).toBe("3 widgets");
    expect(galleryCount(1, " po ")).toBe("1 result for “po”");
    expect(galleryCount(0, "x")).toBe("0 results for “x”");
  });
});

describe("suggestionsFor", () => {
  const views = galleryTiles(READ, [], BY_ID);
  it("keeps a pair whose widget reads a collection and can be added", () => {
    expect(suggestionsFor(READ, views, []).map(s => s.label)).toEqual([
      "Posts count",
    ]);
  });

  it("leaves out a pair the draft already holds, but not one it removed", () => {
    expect(
      suggestionsFor(READ, views, [
        card({ widgetId: "core/count", config: { collection: "posts" } }),
      ])
    ).toEqual([]);
    expect(
      suggestionsFor(READ, views, [
        card({
          widgetId: "core/count",
          config: { collection: "posts" },
          removed: true,
        }),
      ])
    ).toHaveLength(1);
  });
});

describe("startingCollection", () => {
  it("starts on the most-edited collection, else the first readable, else none", () => {
    expect(startingCollection(READ)).toBe("pages");
    expect(startingCollection({ ...READ, mostEdited: undefined })).toBe(
      "posts"
    );
    // A most-edited collection that is no longer readable is not offered.
    expect(startingCollection({ ...READ, mostEdited: "gone" })).toBe("posts");
    expect(startingCollection({ collections: [] })).toBeUndefined();
  });
});

describe("periodOf", () => {
  const widget = (settings: DashboardWidget["settings"]): DashboardWidget => ({
    id: "w",
    title: "W",
    archetype: "custom",
    size: sizeBounds({ default: { w: 6, h: 3 } }),
    settings,
  });

  it("offers a dateRange choice's options, starting at its default", () => {
    expect(
      periodOf(
        widget([
          {
            name: "dateRange",
            type: "select",
            label: "Date range",
            defaultValue: "30d",
            options: [
              { value: "7d", label: "7 days" },
              { value: "30d", label: "30 days" },
            ],
          },
        ])
      )
    ).toEqual({
      name: "dateRange",
      initial: "30d",
      options: [
        { value: "7d", label: "7 days" },
        { value: "30d", label: "30 days" },
      ],
    });
  });

  it("has no period for a widget without one, or with a choice of another name", () => {
    expect(periodOf(widget(undefined))).toBeUndefined();
    expect(
      periodOf(
        widget([
          {
            name: "style",
            type: "select",
            label: "Style",
            options: [{ value: "line", label: "Line" }],
          },
        ])
      )
    ).toBeUndefined();
    expect(periodOf(undefined)).toBeUndefined();
  });
});

describe("widths", () => {
  it("offers the widths within the widget's sizes, and names them on the tile", () => {
    const size = sizeBounds({
      default: { w: 4, h: 3 },
      min: { w: 3, h: 3 },
      max: { w: 6, h: 4 },
    });
    expect(addWidths(size).map(width => width.w)).toEqual([3, 4, 6]);
    expect(addWidths(size)[2]).toEqual({
      w: 6,
      label: "½",
      spoken: "Half width, 6 columns",
    });
    expect(widthsLabel(size)).toBe("¼ to ½ width");
    expect(widthsLabel(sizeBounds({ default: { w: 12, h: 3 } }))).toBe(
      "Full width"
    );
  });
});

describe("newCardSettings", () => {
  it("stores the collection under the widget's own setting, and the period chosen", () => {
    expect(
      newCardSettings(COUNT, {
        collection: "posts",
        period: { name: "dateRange", value: "7d" },
      })
    ).toEqual({ collection: "posts", dateRange: "7d" });
  });

  it("starts a card that reads no collection with no settings", () => {
    expect(newCardSettings(TEAM, { collection: "posts" })).toBeUndefined();
  });
});
