/**
 * What the add panel lists from the server's read and the reader's draft: what each row's control
 * does, what a search keeps, and the collection a new card starts on.
 */
import { sizeBounds } from "nextly/config";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import {
  canAdd,
  collectionsFor,
  galleryRows,
  newCardSettings,
  rowsCount,
  searchRows,
  startingCollection,
  type CanAsk,
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
  collectionSetting: "collection",
  allowsSeveral: true,
});
const TEAM = tile({ id: "core/team", name: "Team", description: "People." });
const SEO = tile({
  id: "seo/score",
  name: "SEO score",
  plugin: "@acme/plugin-seo",
});

const READ: GalleryRead = {
  tiles: [COUNT, TEAM, SEO],
  collections: [
    { slug: "posts", label: "Posts", lifecycle: true },
    { slug: "pages", label: "Pages", lifecycle: false },
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
]);

const every: CanAsk = () => true;

const card = (over: Partial<WidgetPlacement>): WidgetPlacement => ({
  id: "p1",
  widgetId: "core/team",
  w: 4,
  h: 3,
  removed: false,
  ...over,
});

const actions = (placements: WidgetPlacement[], canAsk: CanAsk = every) =>
  galleryRows(READ, placements, BY_ID, canAsk).map(row => [
    row.tile.id,
    row.action,
  ]);

describe("galleryRows", () => {
  it("lists each widget once, in the read's order, with Add", () => {
    expect(actions([])).toEqual([
      ["core/count", { kind: "add" }],
      ["core/team", { kind: "add" }],
      ["seo/score", { kind: "add" }],
    ]);
  });

  it("says a one-card widget the draft holds is on the dashboard; one that allows several is offered again", () => {
    const placed = [
      card({ id: "t", widgetId: "core/team" }),
      card({ id: "c", widgetId: "core/count" }),
    ];
    expect(actions(placed)).toEqual([
      ["core/count", { kind: "add" }],
      ["core/team", { kind: "on-dashboard" }],
      ["seo/score", { kind: "add" }],
    ]);
  });

  it("puts a one-card widget removed this session back, rather than adding a second", () => {
    expect(actions([card({ id: "t-1", removed: true })])[1]).toEqual([
      "core/team",
      { kind: "add-back", placementId: "t-1" },
    ]);
  });

  it("offers nothing to add for a widget no readable collection suits, and leaves the others", () => {
    const rows = galleryRows(READ, [], BY_ID, () => false);
    expect(rows.map(row => [row.tile.id, canAdd(row)])).toEqual([
      ["core/count", false],
      ["core/team", true],
      ["seo/score", true],
    ]);
    expect(rows[0]?.action).toEqual({ kind: "needs-collection" });
    // With no collection at all, the same.
    expect(
      galleryRows({ ...READ, collections: [] }, [], BY_ID, every)[0]?.action
    ).toEqual({ kind: "needs-collection" });
  });

  it("names each row as the dashboard titles its card, and lists none this admin cannot draw", () => {
    const rows = galleryRows(
      { ...READ, tiles: [{ ...TEAM, name: "core/team" }, tile({ id: "x/y" })] },
      [],
      BY_ID,
      every
    );
    expect(rows.map(row => row.tile.name)).toEqual(["Team"]);
  });

  it("names a plugin's widget by its plugin, as the admin names the plugin", () => {
    const rows = galleryRows(READ, [], BY_ID, every, plugin =>
      plugin === "@acme/plugin-seo" ? "SEO" : plugin
    );
    expect(rows.map(row => row.pluginName)).toEqual([
      undefined,
      undefined,
      "SEO",
    ]);
  });
});

describe("searchRows", () => {
  const rows = galleryRows(READ, [], BY_ID, every, () => "SEO");

  it("keeps every row for an empty query", () => {
    expect(searchRows(rows, "  ")).toHaveLength(3);
  });

  it("matches a name, a one line and a plugin's name, ignoring case", () => {
    const ids = (query: string) =>
      searchRows(rows, query).map(row => row.tile.id);
    expect(ids("TEAM")).toEqual(["core/team"]);
    expect(ids("entries a collection")).toEqual(["core/count"]);
    expect(ids("seo")).toEqual(["seo/score"]);
    expect(ids("nothing like it")).toEqual([]);
  });
});

describe("rowsCount", () => {
  it("counts widgets, one in the singular", () => {
    expect(rowsCount(0)).toBe("0 widgets");
    expect(rowsCount(1)).toBe("1 widget");
    expect(rowsCount(12)).toBe("12 widgets");
  });
});

describe("startingCollection", () => {
  it("starts on the first collection no card of the widget is set to", () => {
    expect(startingCollection(COUNT, READ.collections, [])).toEqual({
      slug: "posts",
      taken: false,
    });
    expect(
      startingCollection(COUNT, READ.collections, [
        card({ widgetId: "core/count", config: { collection: "posts" } }),
        // Another widget's card, and a removed one, hold no collection of Count's.
        card({ id: "p2", config: { collection: "pages" } }),
        card({
          id: "p3",
          widgetId: "core/count",
          removed: true,
          config: { collection: "pages" },
        }),
      ])
    ).toEqual({ slug: "pages", taken: false });
  });

  it("gives the first, taken, when every collection has its card", () => {
    expect(
      startingCollection(COUNT, READ.collections, [
        card({ widgetId: "core/count", config: { collection: "pages" } }),
        card({
          id: "p2",
          widgetId: "core/count",
          config: { collection: "posts" },
        }),
      ])
    ).toEqual({ slug: "posts", taken: true });
  });

  it("starts on none for a widget that reads none, or with none to start on", () => {
    expect(startingCollection(TEAM, READ.collections, [])).toBeUndefined();
    expect(startingCollection(COUNT, [], [])).toBeUndefined();
  });

  it("starts only on a collection the widget can ask", () => {
    // Count can ask Pages alone.
    const canAsk: CanAsk = (_, slug) => slug === "pages";
    const own = collectionsFor("core/count", READ.collections, canAsk);
    expect(own.map(c => c.slug)).toEqual(["pages"]);
    expect(startingCollection(COUNT, own, [])).toEqual({
      slug: "pages",
      taken: false,
    });
  });
});

describe("newCardSettings", () => {
  it("stores the collection under the widget's own setting", () => {
    expect(
      newCardSettings({ ...COUNT, collectionSetting: "source" }, "posts")
    ).toEqual({ source: "posts" });
  });

  it("starts a card that reads no collection, or has none to start on, with no settings", () => {
    expect(newCardSettings(TEAM, "posts")).toBeUndefined();
    expect(newCardSettings(COUNT, undefined)).toBeUndefined();
  });
});
