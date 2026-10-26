/**
 * The saved per-collection cards core once generated, as the widgets offered
 * per collection, for one reader: which collection each resolves to, which
 * merge, and which stay withheld because naming their collection would tell
 * the reader of one they may not read.
 */
import { describe, expect, it } from "vitest";

import { CORE_WIDGETS } from "../core-widgets";
import {
  generatedCardConversion,
  resolveGeneratedCardCollection,
} from "../generated-card-conversion";
import { applyRetirements, type WidgetPlacement } from "../layout";
import { naturalGroupBy } from "../settings";

/** A current-format card. */
function card(
  id: string,
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return { id, widgetId, width: "quarter", removed: false, ...patch };
}

const set = (...slugs: string[]) => new Set(slugs);

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
    applyRetirements(placements, generatedCardConversion(readable, existing));

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
      generatedCardConversion(set("posts"), set("posts"), set(), successor =>
        successor === COUNT_WIDGET_ID ? ["quarter", "half", "full"] : undefined
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

  it("keeps a deleted collection's cards as one Count card set to none", () => {
    const converted = convert(
      [
        card("count", "collection/gone-count"),
        card("health", "collection/gone-stats"),
        card("other", "collection/old-count"),
      ],
      set("posts"),
      set("posts")
    );
    // No collection, so no slug reaches the reader, and the card draws
    // "not available". Two deleted collections stay two cards.
    expect(converted).toEqual([
      card("count", COUNT_WIDGET_ID),
      card("other", COUNT_WIDGET_ID),
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
          set("collection/posts-count")
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
    applyRetirements(placements, generatedCardConversion(readable, readable));

  it("makes each kind its successor set to the collection and nothing else, as a card added from the add panel is", () => {
    // 🔴 Set to its collection ALONE: what the old card showed is the
    // successor's own behaviour at that width, so a converted card and one
    // added today are the same card, drawn by one path.
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
        config: { collection: "posts" },
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
        generatedCardConversion(set("posts"), set("posts", "secret"))
      )
    ).toEqual([stored]);
  });

  it("keeps a deleted collection's card as its successor set to none", () => {
    expect(
      convert([card("gone", "collection/gone-timeline")], set("posts"))
    ).toEqual([card("gone", OVER_TIME)]);
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

  it("divides Breakdown by status on a collection with a lifecycle, the only kind a breakdown card was saved for", () => {
    const groupBy = setting("core/breakdown", "groupBy");
    expect(groupBy?.defaultValue).toBeUndefined();
    expect(groupBy?.defaultFrom).toBe("collection");
    expect(
      naturalGroupBy({
        lifecycle: true,
        fields: [{ name: "kind", choices: ["a", "b"] }],
      })
    ).toBe("status");
  });
});
