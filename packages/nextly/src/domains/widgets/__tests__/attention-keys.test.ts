import { describe, expect, it } from "vitest";

import {
  ATTENTION_KINDS,
  attentionPartKey,
  attentionTotalOf,
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

describe("Needs attention's total", () => {
  it("sums each kind's own bucket and never its parts, which break a kind down", () => {
    expect(
      attentionTotalOf([
        { value: "unpublished", count: 3 },
        { value: "unpublished:collection:posts", count: 2 },
        { value: "unpublished:single:home", count: 1 },
        { value: "scheduled", count: 2 },
        { value: "scheduled:collection:posts", count: 2 },
        { value: "overdue", count: 1 },
      ])
    ).toEqual({ count: 6, atLeast: false });
  });

  it("is a floor when any kind's count is one, a zero floor included", () => {
    expect(
      attentionTotalOf([
        { value: "unpublished", count: 99, atLeast: true },
        { value: "overdue", count: 1 },
      ])
    ).toEqual({ count: 100, atLeast: true });
    expect(
      attentionTotalOf([{ value: "scheduled", count: 0, atLeast: true }])
    ).toEqual({ count: 0, atLeast: true });
  });

  it("adds nothing for a bucket it does not name, a null bucket or a count below one", () => {
    expect(
      attentionTotalOf([
        { value: "plugin:seo", count: 4, atLeast: true },
        { value: null, count: 5 },
        { value: "overdue", count: -2 },
        { value: "unpublished", count: 1 },
      ])
    ).toEqual({ count: 1, atLeast: false });
  });
});
