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

  it.each([
    "",
    "nothing",
    "unpublished:",
    "unpublished:page:home",
    "unpublished:collection:",
    "unpublished:collection:posts:extra",
    "Unpublished",
  ])("reads %j as no key at all", value => {
    expect(parseAttentionKey(value)).toBeNull();
  });
});
