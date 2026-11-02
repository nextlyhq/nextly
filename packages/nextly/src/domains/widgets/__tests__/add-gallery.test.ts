/**
 * The add gallery's rules that need no database (dashboard-experience R-19, R-20): the chip each
 * widget is listed under, the gallery's order, how the reader's collections are ranked, and which
 * widget and collection pairs are suggested.
 */
import { describe, expect, it } from "vitest";

import {
  editsByCollection,
  galleryCategoryOf,
  inGalleryOrder,
  MAX_GALLERY_SUGGESTIONS,
  rankCollections,
  suggestedPairs,
  type GalleryCollection,
} from "../add-panel";
import type { CanonicalWidget } from "../canonical";
import { CORE_WIDGET_ID, CORE_WIDGET_IDS } from "../core-widgets/ids";

const collection = (
  slug: string,
  over: Partial<GalleryCollection> = {}
): GalleryCollection => ({
  slug,
  label: slug.charAt(0).toUpperCase() + slug.slice(1),
  lifecycle: true,
  ...over,
});

const POSTS = collection("posts", { entries: 40 });
const PAGES = collection("pages", { entries: 12 });
const AUTHORS = collection("authors", { entries: 90, lifecycle: false });

const everyWidget = () => true;
const nothingPlaced = () => false;

describe("galleryCategoryOf", () => {
  it("lists every one of core's widgets under a chip", () => {
    for (const id of CORE_WIDGET_IDS) {
      expect(galleryCategoryOf({ id }), id).toEqual(expect.any(String));
    }
    expect(galleryCategoryOf({ id: CORE_WIDGET_ID.overTime })).toBe("trends");
    expect(galleryCategoryOf({ id: CORE_WIDGET_ID.count })).toBe("content");
    expect(galleryCategoryOf({ id: CORE_WIDGET_ID.teamActivity })).toBe(
      "activity"
    );
  });

  it("lists a plugin's widget under Plugins, whatever it declares, an override of a built-in too", () => {
    expect(
      galleryCategoryOf({ id: "seo/score", plugin: "seo", category: "Trends" })
    ).toBe("plugins");
    expect(galleryCategoryOf({ id: CORE_WIDGET_ID.count, plugin: "seo" })).toBe(
      "plugins"
    );
  });

  it("lists a site widget under the chip its category names, else under All alone", () => {
    expect(galleryCategoryOf({ id: "site/a", category: " trends " })).toBe(
      "trends"
    );
    expect(galleryCategoryOf({ id: "site/b", category: "Activity" })).toBe(
      "activity"
    );
    // A free-text category is searched, never a chip of its own; Plugins is not a site's.
    expect(galleryCategoryOf({ id: "site/c", category: "Sales" })).toBe(
      undefined
    );
    expect(galleryCategoryOf({ id: "site/d", category: "plugins" })).toBe(
      undefined
    );
    expect(galleryCategoryOf({ id: "site/e" })).toBe(undefined);
  });
});

describe("inGalleryOrder", () => {
  it("lists core's add-only widgets first, then the site's, then each plugin's as they came", () => {
    const widgets: CanonicalWidget[] = [
      { id: "b/one", plugin: "b" },
      { id: "site/x" },
      { id: CORE_WIDGET_ID.teamActivity },
      { id: "a/one", plugin: "a" },
      { id: CORE_WIDGET_ID.count },
      { id: "b/two", plugin: "b" },
      { id: "site/y" },
    ];
    expect(inGalleryOrder(widgets).map(widget => widget.id)).toEqual([
      CORE_WIDGET_ID.count,
      CORE_WIDGET_ID.teamActivity,
      "site/x",
      "site/y",
      "b/one",
      "b/two",
      "a/one",
    ]);
  });
});

describe("editsByCollection", () => {
  const since = new Date("2026-10-01T00:00:00.000Z");
  it("counts each collection's documents saved since the window opened", () => {
    expect(
      editsByCollection(
        [
          { collection: "posts", createdAt: "2026-10-20T00:00:00.000Z" },
          {
            collection: "posts",
            subjectKind: "collection",
            createdAt: "2026-10-02T00:00:00.000Z",
          },
          { collection: "pages", createdAt: "2026-10-01T00:00:00.000Z" },
          // Before the window.
          { collection: "pages", createdAt: "2026-09-30T23:59:59.000Z" },
          // A Single's and a settings change's rows name no collection's entry.
          {
            collection: "home",
            subjectKind: "single",
            createdAt: "2026-10-20T00:00:00.000Z",
          },
          {
            collection: "nx_settings",
            subjectKind: "settings",
            createdAt: "2026-10-20T00:00:00.000Z",
          },
          { collection: "posts", createdAt: "not a date" },
        ],
        since
      )
    ).toEqual(
      new Map([
        ["posts", 2],
        ["pages", 1],
      ])
    );
  });
});

describe("rankCollections", () => {
  it("ranks the collections the reader edited, most edits first, and names the first", () => {
    const ranked = rankCollections(
      [POSTS, PAGES, AUTHORS],
      new Map([
        ["pages", 5],
        ["posts", 2],
      ])
    );
    expect(ranked.ranked.map(c => c.slug)).toEqual(["pages", "posts"]);
    expect(ranked.mostEdited).toBe("pages");
  });

  it("breaks a tie in edits by entries, then by label", () => {
    const ranked = rankCollections(
      [PAGES, POSTS, collection("zines", { entries: 40 })],
      new Map([
        ["pages", 1],
        ["posts", 1],
        ["zines", 1],
      ])
    );
    expect(ranked.ranked.map(c => c.slug)).toEqual(["posts", "zines", "pages"]);
  });

  it("ranks nothing by a save in a collection the reader may no longer read", () => {
    const ranked = rankCollections([POSTS], new Map([["secret", 9]]));
    expect(ranked.mostEdited).toBeUndefined();
    expect(ranked.ranked.map(c => c.slug)).toEqual(["posts"]);
  });

  it("with nothing edited, ranks every readable collection by its entries, an uncounted one last", () => {
    const ranked = rankCollections(
      [PAGES, collection("drafts"), POSTS, AUTHORS],
      new Map()
    );
    expect(ranked.ranked.map(c => c.slug)).toEqual([
      "authors",
      "posts",
      "pages",
      "drafts",
    ]);
    expect(ranked.mostEdited).toBeUndefined();
  });
});

describe("suggestedPairs", () => {
  it("spreads the top collections across the row, round by round", () => {
    expect(
      suggestedPairs({
        ranked: [POSTS, PAGES],
        offered: everyWidget,
        onDashboard: nothingPlaced,
      })
    ).toEqual([
      {
        widgetId: CORE_WIDGET_ID.recentEntries,
        collection: "posts",
        label: "Recent Posts",
      },
      {
        widgetId: CORE_WIDGET_ID.overTime,
        collection: "pages",
        label: "Pages over time",
      },
      {
        widgetId: CORE_WIDGET_ID.breakdown,
        collection: "posts",
        label: "Posts by status",
      },
      {
        widgetId: CORE_WIDGET_ID.recentEntries,
        collection: "pages",
        label: "Recent Pages",
      },
    ]);
  });

  it("suggests at most four", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(slug => collection(slug));
    const pairs = suggestedPairs({
      ranked: many,
      offered: everyWidget,
      onDashboard: nothingPlaced,
    });
    expect(pairs).toHaveLength(MAX_GALLERY_SUGGESTIONS);
    expect(MAX_GALLERY_SUGGESTIONS).toBe(4);
  });

  it("leaves out pairs already on the dashboard, and fills the row from the next", () => {
    const pairs = suggestedPairs({
      ranked: [POSTS, PAGES],
      offered: everyWidget,
      onDashboard: (widgetId, slug) =>
        widgetId === CORE_WIDGET_ID.recentEntries && slug === "posts",
    });
    expect(pairs.map(pair => pair.label)).toEqual([
      "Pages over time",
      "Posts by status",
      "Recent Pages",
      "Posts over time",
    ]);
  });

  it("suggests by status only for a collection with a lifecycle", () => {
    const pairs = suggestedPairs({
      ranked: [AUTHORS],
      offered: everyWidget,
      onDashboard: nothingPlaced,
    });
    expect(pairs.map(pair => pair.label)).toEqual([
      "Recent Authors",
      "Authors over time",
    ]);
  });

  it("suggests no widget the reader may not add", () => {
    const pairs = suggestedPairs({
      ranked: [POSTS],
      offered: widgetId => widgetId !== CORE_WIDGET_ID.overTime,
      onDashboard: nothingPlaced,
    });
    expect(pairs.map(pair => pair.widgetId)).toEqual([
      CORE_WIDGET_ID.recentEntries,
      CORE_WIDGET_ID.breakdown,
    ]);
  });

  it("suggests from the collections with the most entries when the reader edited none", () => {
    const { ranked } = rankCollections([PAGES, POSTS, AUTHORS], new Map());
    const pairs = suggestedPairs({
      ranked,
      offered: everyWidget,
      onDashboard: nothingPlaced,
    });
    expect(pairs[0]).toMatchObject({ collection: "authors" });
  });

  it("suggests nothing to a reader who may read no collection", () => {
    expect(
      suggestedPairs({
        ranked: [],
        offered: everyWidget,
        onDashboard: nothingPlaced,
      })
    ).toEqual([]);
  });
});
