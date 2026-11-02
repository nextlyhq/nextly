import { describe, expect, it } from "vitest";

import {
  ATTENTION_KINDS,
  attentionPartKey,
  digestTotal,
  isDrawnAttentionItem,
  parseAttentionKey,
} from "../attention-keys";

describe("Needs attention's keys", () => {
  it.each(ATTENTION_KINDS)(
    "reads the kind %s alone back as its total",
    kind => {
      expect(parseAttentionKey(kind)).toEqual({ kind });
    }
  );

  it("reads a part back into its kind and where it lives, for a collection and a Single", () => {
    for (const contentKind of ["collection", "single"] as const) {
      expect(
        parseAttentionKey(attentionPartKey("unpublished", contentKind, "posts"))
      ).toEqual({ kind: "unpublished", part: { contentKind, slug: "posts" } });
    }
  });

  it("carries a Single's language through its key, and never a collection's", () => {
    const single = attentionPartKey("unpublished", "single", "home", "fr");
    expect(single).toBe("unpublished:single:home:fr");
    expect(parseAttentionKey(single)).toEqual({
      kind: "unpublished",
      part: { contentKind: "single", slug: "home", locale: "fr" },
    });
    // A collection's part has no language: its list is the one place it lives.
    expect(attentionPartKey("unpublished", "collection", "posts", "fr")).toBe(
      "unpublished:collection:posts"
    );
  });

  it.each([
    "",
    "nothing",
    "unpublished:single:home:",
    "unpublished:single:home:fr:extra",
    "unpublished:",
    "unpublished:page:home",
    "unpublished:collection:",
    "unpublished:collection:posts:extra",
    "Unpublished",
  ])("reads %j as no key at all", value => {
    expect(parseAttentionKey(value)).toBeNull();
  });
});

describe("the attention digest's total", () => {
  /** One digest item as the source answers it. */
  const item = (fields: Record<string, unknown>) => ({
    id: "core/overdue-releases",
    kind: "overdue",
    label: "Overdue releases",
    count: 1,
    severity: "critical",
    link: "releases?tab=attention&reason=overdue",
    ...fields,
  });

  it("counts the items, never the sum of their counts", () => {
    // Three items holding 7, 2 and 40: a total that summed would be 49.
    expect(
      digestTotal([
        item({ id: "a/1", count: 7 }),
        item({ id: "a/2", count: 2 }),
        item({ id: "a/3", count: 40 }),
      ])
    ).toEqual({ count: 3, atLeast: false });
    expect(digestTotal([])).toEqual({ count: 0, atLeast: false });
  });

  it("is a floor when an item failed, or when an item's own count is one", () => {
    expect(
      digestTotal([item({}), item({ id: "a/2", count: 0, failed: true })])
    ).toEqual({ count: 2, atLeast: true });
    expect(
      digestTotal([item({}), item({ id: "a/2", count: 99, atLeast: true })])
    ).toEqual({ count: 2, atLeast: true });
    // A failed item alone is still an item: one, and unknown beyond it.
    expect(digestTotal([item({ count: 0, failed: true })])).toEqual({
      count: 1,
      atLeast: true,
    });
  });

  it("counts only what the card draws, by the card's own test of an item", () => {
    const answer: unknown[] = [
      item({}),
      item({ id: "" }),
      item({ label: "" }),
      { id: "a/4" },
      // A floor on an item that is not drawn makes nothing a floor.
      { id: "a/5", atLeast: true },
      "not an item",
      null,
      [item({})],
    ];
    expect(answer.filter(isDrawnAttentionItem)).toHaveLength(1);
    expect(digestTotal(answer)).toEqual({ count: 1, atLeast: false });
  });
});
