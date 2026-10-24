/**
 * The saved per-collection count and health cards, as Count cards, for one
 * reader: which collection each resolves to, which merge, and which stay
 * withheld because naming their collection would tell the reader of one they
 * may not read.
 */
import { describe, expect, it } from "vitest";

import {
  countCardConversion,
  resolveCountCardCollection,
} from "../count-conversion";
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

/** The widget saved count and health cards become. */
const COUNT_WIDGET_ID = "core/count";

describe("which collection a saved card's id resolves to", () => {
  it("names the one readable collection the id spells, with `_` read as `-`", () => {
    expect(
      resolveCountCardCollection("posts", set("posts"), set("posts"))
    ).toEqual({ kind: "one", collection: "posts" });
    expect(
      resolveCountCardCollection(
        "blog-posts",
        set("blog_posts"),
        set("blog_posts")
      )
    ).toEqual({ kind: "one", collection: "blog_posts" });
  });

  it("names none when two readable collections spell the same id", () => {
    // 🔴 Either answer could be the wrong collection's number.
    expect(
      resolveCountCardCollection("a-b", set("a_b", "a-b"), set("a_b", "a-b"))
    ).toEqual({ kind: "none" });
  });

  it("names none when the install holds two collections the id spells, though the reader may read only one", () => {
    // 🔴 The card may have been the one they may not read, now hidden or
    // without a source: naming the readable one would draw the wrong number.
    expect(
      resolveCountCardCollection("a-b", set("a-b"), set("a_b", "a-b"))
    ).toEqual({ kind: "none" });
  });

  it("names none when no collection in the install matches: it was deleted", () => {
    expect(
      resolveCountCardCollection("gone", set("posts"), set("posts"))
    ).toEqual({ kind: "none" });
  });

  it("withholds a card whose only match is a collection this reader may not read", () => {
    // 🔴 Readable only: the install's other collection is never named.
    expect(
      resolveCountCardCollection("a-b", set("posts"), set("posts", "a_b"))
    ).toEqual({ kind: "withheld" });
  });

  it("withholds rather than calling a collection deleted while the registry is unread", () => {
    expect(resolveCountCardCollection("gone", set("posts"), undefined)).toEqual(
      { kind: "withheld" }
    );
  });
});

describe("saved count and health cards, converted for one reader", () => {
  const convert = (
    placements: WidgetPlacement[],
    readable: Set<string>,
    existing: Set<string> | undefined = readable
  ) => applyRetirements(placements, countCardConversion(readable, existing));

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
      countCardConversion(set("posts"), set("posts"), set(), [
        "quarter",
        "half",
        "full",
      ])
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
        countCardConversion(
          set("posts"),
          set("posts"),
          set("collection/posts-count")
        )
      )
    ).toBe(placements);
  });

  it("does not touch the other generated cards, or ids that only look alike", () => {
    const placements = [
      card("recent", "collection/posts-recent"),
      card("single", "single/posts-count"),
      card("near", "collection/posts-counts"),
      card("nested", "collection/posts/x-count"),
    ];
    expect(convert(placements, set("posts"))).toBe(placements);
  });
});
