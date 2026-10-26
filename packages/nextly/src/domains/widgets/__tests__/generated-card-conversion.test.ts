/**
 * The saved per-collection cards core once generated, as the widgets offered
 * per collection, for one reader: which collection each resolves to, which
 * merge, and which stay withheld because naming their collection would tell
 * the reader of one they may not read.
 */
import { describe, expect, it } from "vitest";

import { CORE_WIDGETS } from "../core-widgets";
import {
  conversionFacts,
  generatedCardConversion,
  registeredWidths,
  resolveGeneratedCardCollection,
  type GeneratedCard,
} from "../generated-card-conversion";
import { applyRetirements, type WidgetPlacement } from "../layout";

/** A current-format card. */
function card(
  id: string,
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return { id, widgetId, width: "quarter", removed: false, ...patch };
}

const set = (...slugs: string[]) => new Set(slugs);

/** Core generates every id, each timeline counting by `createdAt`. */
const everyGenerated = (): GeneratedCard => ({
  query: { dateField: "createdAt" },
});

/** Core generates these ids only, each timeline counting by `createdAt`. */
const generatedOnly =
  (...ids: string[]) =>
  (widgetId: string): GeneratedCard | undefined =>
    ids.includes(widgetId) ? everyGenerated() : undefined;

/** The widget saved count and health cards become. */
const COUNT_WIDGET_ID = "core/count";

describe("which collection a saved card's id resolves to", () => {
  it("names the one readable collection the id spells, with `_` read as `-`", () => {
    expect(
      resolveGeneratedCardCollection("posts", set("posts"), set("posts"))
    ).toEqual({ kind: "one", collection: "posts" });
    expect(
      resolveGeneratedCardCollection(
        "blog-posts",
        set("blog_posts"),
        set("blog_posts")
      )
    ).toEqual({ kind: "one", collection: "blog_posts" });
  });

  it("names none when two readable collections spell the same id", () => {
    // 🔴 Either answer could be the wrong collection's number.
    expect(
      resolveGeneratedCardCollection(
        "a-b",
        set("a_b", "a-b"),
        set("a_b", "a-b")
      )
    ).toEqual({ kind: "none" });
  });

  it("names the one readable match even when an unreadable collection spells the same id", () => {
    // 🔴 Counting the unreadable one would set the card to none here and to
    // `a-b` without it, telling the reader that collection exists.
    expect(
      resolveGeneratedCardCollection("a-b", set("a-b"), set("a_b", "a-b"))
    ).toEqual(resolveGeneratedCardCollection("a-b", set("a-b"), set("a-b")));
    expect(
      resolveGeneratedCardCollection("a-b", set("a-b"), set("a_b", "a-b"))
    ).toEqual({ kind: "one", collection: "a-b" });
  });

  it("names none when no collection in the install matches: it was deleted", () => {
    expect(
      resolveGeneratedCardCollection("gone", set("posts"), set("posts"))
    ).toEqual({ kind: "none" });
  });

  it("withholds a card whose only match is a collection this reader may not read", () => {
    // 🔴 Readable only: the install's other collection is never named.
    expect(
      resolveGeneratedCardCollection("a-b", set("posts"), set("posts", "a_b"))
    ).toEqual({ kind: "withheld" });
  });

  it("withholds rather than calling a collection deleted while the registry is unread", () => {
    expect(
      resolveGeneratedCardCollection("gone", set("posts"), undefined)
    ).toEqual({ kind: "withheld" });
  });
});

describe("saved count and health cards, converted for one reader", () => {
  const convert = (
    placements: WidgetPlacement[],
    readable: Set<string>,
    existing: Set<string> | undefined = readable
  ) =>
    applyRetirements(
      placements,
      generatedCardConversion(
        readable,
        existing,
        set(),
        undefined,
        everyGenerated
      )
    );

  it("makes a count card a Count card set to its collection, keeping its id, place and width", () => {
    expect(
      convert(
        [
          card("a", "core/team"),
          card("p", "collection/blog-posts-count", { width: "third" }),
        ],
        set("blog_posts")
      )
    ).toEqual([
      card("a", "core/team"),
      card("p", COUNT_WIDGET_ID, {
        width: "third",
        config: { collection: "blog_posts" },
      }),
    ]);
  });

  it("merges a collection's count and health cards: the first one's id and place, the widest width Count allows", () => {
    const [merged, ...rest] = convert(
      [
        card("health", "collection/posts-stats", { width: "full" }),
        card("other", "core/team"),
        card("count", "collection/posts-count", { width: "half" }),
      ],
      set("posts")
    );
    // Count stops at two thirds, so the health card's full width is not taken.
    expect(merged).toEqual(
      card("health", COUNT_WIDGET_ID, {
        width: "half",
        config: { collection: "posts" },
      })
    );
    expect(rest).toEqual([card("other", "core/team")]);
  });

  it("takes the merged width from the registered Count's widths", () => {
    // A plugin may widen Count; its full width is then kept.
    const [merged] = applyRetirements(
      [
        card("health", "collection/posts-stats", { width: "full" }),
        card("count", "collection/posts-count", { width: "half" }),
      ],
      generatedCardConversion(
        set("posts"),
        set("posts"),
        set(),
        successor =>
          successor === COUNT_WIDGET_ID
            ? ["quarter", "half", "full"]
            : undefined,
        everyGenerated
      )
    );
    expect(merged.width).toBe("full");
  });

  it("removes the merged card only if every card in it was removed", () => {
    const [kept] = convert(
      [
        card("count", "collection/posts-count", { removed: true }),
        card("health", "collection/posts-stats"),
      ],
      set("posts")
    );
    expect(kept.removed).toBe(false);
    const [gone] = convert(
      [
        card("count", "collection/posts-count", { removed: true }),
        card("health", "collection/posts-stats", { removed: true }),
      ],
      set("posts")
    );
    expect(gone.removed).toBe(true);
  });

  it("merges into a Count card the layout already holds for the same collection", () => {
    expect(
      convert(
        [
          card("count", "collection/posts-count"),
          card("mine", COUNT_WIDGET_ID, {
            width: "half",
            config: { collection: "posts" },
          }),
        ],
        set("posts")
      )
    ).toEqual([
      card("mine", COUNT_WIDGET_ID, {
        width: "half",
        config: { collection: "posts" },
      }),
    ]);
  });

  it("keeps different collections' cards apart", () => {
    const converted = convert(
      [
        card("posts", "collection/posts-count"),
        card("products", "collection/products-stats"),
      ],
      set("posts", "products")
    );
    expect(converted.map(placement => placement.config)).toEqual([
      { collection: "posts" },
      { collection: "products" },
    ]);
  });

  it("leaves a card whose collection this reader may not read exactly as stored", () => {
    const stored = card("secret", "collection/secret-count");
    expect(convert([stored], set("posts"), set("posts", "secret"))).toEqual([
      stored,
    ]);
  });

  it("leaves a deleted collection's cards as stored: core generates none for it", () => {
    // 🔴 An id core does not generate today is not known to be core's card,
    // so nothing is converted that could not be converted exactly.
    const placements = [
      card("count", "collection/gone-count"),
      card("health", "collection/gone-stats"),
    ];
    expect(
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set(),
          undefined,
          generatedOnly("collection/posts-count")
        )
      )
    ).toBe(placements);
  });

  it("leaves a plugin's card under a generated-looking id as stored while the plugin is disabled", () => {
    // Declared by nobody while its plugin is off, and generated by nobody
    // either: whose card it is cannot be told, so it is not converted.
    const placements = [card("plugin", "collection/posts-table")];
    expect(
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set(),
          undefined,
          generatedOnly("collection/posts-count")
        )
      )
    ).toBe(placements);
    // The must-differ half: core's own card under that id converts.
    expect(
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set(),
          undefined,
          generatedOnly("collection/posts-table")
        )
      )
    ).toEqual([
      card("plugin", "core/recent-entries", {
        config: { collection: "posts" },
      }),
    ]);
  });

  it("leaves the cards of a widget declared under a generated-looking id as they are", () => {
    const placements = [card("plugin", "collection/posts-count")];
    expect(
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set("collection/posts-count"),
          undefined,
          everyGenerated
        )
      )
    ).toBe(placements);
  });

  it("does not touch ids that only look like a generated card's", () => {
    const placements = [
      card("single", "single/posts-count"),
      card("kind", "collection/posts-chart"),
      card("near", "collection/posts-counts"),
      card("nested", "collection/posts/x-count"),
    ];
    expect(convert(placements, set("posts"))).toBe(placements);
  });
});

describe("saved list, table, timeline and breakdown cards, converted for one reader", () => {
  const RECENT = "core/recent-entries";
  const OVER_TIME = "core/over-time";
  const BREAKDOWN = "core/breakdown";
  const convert = (placements: WidgetPlacement[], readable: Set<string>) =>
    applyRetirements(
      placements,
      generatedCardConversion(
        readable,
        readable,
        set(),
        undefined,
        everyGenerated
      )
    );

  it("makes each kind its successor set to the collection, as a card added from the add panel is, and a breakdown by status", () => {
    // 🔴 Set to its collection: what the old card showed is the successor's
    // own behaviour at that width, so a converted card and one added today
    // are the same card, drawn by one path. A breakdown also keeps "by
    // status", which Breakdown's default would not promise.
    expect(
      convert(
        [
          card("list", "collection/posts-recent", { width: "half" }),
          card("chart", "collection/posts-timeline", { width: "full" }),
          card("split", "collection/posts-breakdown", { width: "third" }),
        ],
        set("posts")
      )
    ).toEqual([
      card("list", RECENT, { width: "half", config: { collection: "posts" } }),
      card("chart", OVER_TIME, {
        width: "full",
        config: { collection: "posts" },
      }),
      card("split", BREAKDOWN, {
        width: "third",
        config: { collection: "posts", groupBy: "status" },
      }),
    ]);
  });

  it("merges a collection's list and table cards into one Recent entries card, the first one's id and place", () => {
    const [merged, ...rest] = convert(
      [
        card("table", "collection/posts-table", { width: "full" }),
        card("other", "core/team"),
        card("list", "collection/posts-recent", { width: "half" }),
      ],
      set("posts")
    );
    expect(merged).toEqual(
      card("table", RECENT, { width: "full", config: { collection: "posts" } })
    );
    expect(rest).toEqual([card("other", "core/team")]);
  });

  it("keeps different collections, and different successors, apart", () => {
    const converted = convert(
      [
        card("posts", "collection/posts-recent"),
        card("pages", "collection/pages-recent"),
        card("timeline", "collection/posts-timeline"),
      ],
      set("posts", "pages")
    );
    expect(converted.map(placement => placement.widgetId)).toEqual([
      RECENT,
      RECENT,
      OVER_TIME,
    ]);
  });

  it("merges into a plain card of the successor the layout holds for the collection, never into one with other settings", () => {
    const filtered = card("news", RECENT, {
      config: { collection: "posts", filter: { title: { contains: "news" } } },
    });
    const plain = card("held", RECENT, {
      width: "half",
      config: { collection: "posts" },
    });
    // 🔴 Merged into the filtered list, the reader would lose the plain list
    // the old card showed them.
    expect(
      convert([filtered, card("old", "collection/posts-recent")], set("posts"))
    ).toEqual([
      filtered,
      card("old", RECENT, { config: { collection: "posts" } }),
    ]);
    // The must-differ half: a plain card for the collection takes the merge.
    expect(
      convert([plain, card("old", "collection/posts-recent")], set("posts"))
    ).toEqual([plain]);
  });

  it("leaves a card whose collection this reader may not read exactly as stored", () => {
    const stored = card("secret", "collection/secret-breakdown");
    expect(
      applyRetirements(
        [stored],
        generatedCardConversion(
          set("posts"),
          set("posts", "secret"),
          set(),
          undefined,
          everyGenerated
        )
      )
    ).toEqual([stored]);
  });

  it("leaves a timeline counted by another date field than Over time's as stored", () => {
    // 🔴 On a collection without timestamps the timeline counted by its own
    // date field; Over time counts `createdAt`, so converting it would change
    // what the card shows.
    const placements = [card("chart", "collection/posts-timeline")];
    const convertWith = (dateField: string) =>
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set(),
          undefined,
          () => ({ query: { dateField } })
        )
      );
    expect(convertWith("eventOn")).toBe(placements);
    // The must-differ half: counted by `createdAt`, it converts.
    expect(convertWith("createdAt")).toEqual([
      card("chart", OVER_TIME, { config: { collection: "posts" } }),
    ]);
  });

  it("leaves a breakdown as stored once its collection has no lifecycle: core generates none", () => {
    // Converted then, Breakdown would divide by another field under a card
    // that meant draft against published.
    const placements = [card("split", "collection/posts-breakdown")];
    expect(
      applyRetirements(
        placements,
        generatedCardConversion(
          set("posts"),
          set("posts"),
          set(),
          undefined,
          generatedOnly("collection/posts-count")
        )
      )
    ).toBe(placements);
  });
});

describe("the successors' defaults a converted card relies on", () => {
  const setting = (widgetId: string, name: string) =>
    CORE_WIDGETS.find(widget => widget.id === widgetId)?.settings?.find(
      entry => entry.name === name
    ) as { defaultValue?: unknown; defaultFrom?: unknown } | undefined;

  it("draws Over time over the last 30 days, as a saved timeline card did", () => {
    // 🔴 A converted card stores no range, so it is this default that keeps
    // the promise; changing it changes every converted card.
    expect(setting("core/over-time", "dateRange")?.defaultValue).toBe("30d");
  });
});

describe("the facts a conversion is exact on, as scope-token inputs", () => {
  const timeline = (dateField: string) => ({
    id: "collection/posts-timeline",
    query: { op: "timeseries", dateField },
  });

  it("changes when a timeline's date field changes, its id unchanged", () => {
    // 🔴 Counted by another date, a converted timeline is stored as it was
    // again: a save from the snapshot that converted it must be stale.
    expect(conversionFacts([timeline("createdAt")])).not.toEqual(
      conversionFacts([timeline("eventOn")])
    );
  });

  it("holds only the cards whose conversion depends on more than their id", () => {
    expect(
      conversionFacts([
        timeline("createdAt"),
        { id: "collection/posts-count", query: { op: "count" } },
        { id: "collection/posts-breakdown", query: { op: "groupBy" } },
      ])
    ).toHaveLength(1);
  });
});

describe("each successor's widths as registered", () => {
  it("reads the install's widget, whether or not a reader may see it", () => {
    // 🔴 From the canonical set the caller passes, never a reader's visible
    // cards: a plugin's wider Count is honoured for a reader without its gate.
    const widths = registeredWidths([
      { id: COUNT_WIDGET_ID, allowedWidths: ["quarter", "full"] },
    ]);
    expect(widths(COUNT_WIDGET_ID)).toEqual(["quarter", "full"]);
    expect(widths("core/over-time")).toBeUndefined();
  });
});
