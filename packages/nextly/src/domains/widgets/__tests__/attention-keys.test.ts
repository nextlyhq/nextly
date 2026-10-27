import { describe, expect, it } from "vitest";

import {
  ATTENTION_KINDS,
  attentionPartKey,
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
