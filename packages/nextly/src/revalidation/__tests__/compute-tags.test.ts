import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import {
  collectionTag,
  computeEntryRevalidation,
  computeSingleRevalidation,
  entryIdLocaleTag,
  entryIdTag,
  entrySlugTag,
  singleTag,
} from "../compute-tags";

describe("tag builders", () => {
  it("formats each tag tier with the nextly namespace and discriminators", () => {
    expect(collectionTag("posts")).toBe("nextly:posts");
    expect(entryIdTag("posts", "42")).toBe("nextly:posts:id:42");
    expect(entryIdLocaleTag("posts", "42", "de")).toBe("nextly:posts:id:42:de");
    expect(entrySlugTag("posts", "hello-world")).toBe(
      "nextly:posts:slug:hello-world"
    );
    expect(singleTag("header")).toBe("nextly:single:header");
  });

  it("discriminates id from slug so a numeric id and a numeric slug never collide", () => {
    // Without the `:id:`/`:slug:` discriminators these would both be
    // `nextly:posts:7`; the discriminator keeps them distinct.
    expect(entryIdTag("posts", "7")).not.toBe(entrySlugTag("posts", "7"));
  });

  it("bounds an over-long slug tag below Next's 256-char cap, deterministically", () => {
    // Next silently drops a tag longer than 256 chars, so a long slug must hash
    // to a bounded, stable tag that both the write and the read derive alike.
    const longSlug = "a".repeat(300);
    const tag = entrySlugTag("posts", longSlug);
    expect(tag.length).toBeLessThanOrEqual(256);
    expect(tag).toBe(entrySlugTag("posts", longSlug)); // stable
    expect(tag.startsWith("nextly:posts:slug:h:")).toBe(true);
    // A different long slug yields a different tag (no accidental merge).
    expect(tag).not.toBe(entrySlugTag("posts", "b".repeat(300)));
    // A short slug is left untouched (no needless hashing).
    expect(entrySlugTag("posts", "intro")).toBe("nextly:posts:slug:intro");
  });

  it("rejects a blank segment rather than emitting a malformed tag", () => {
    // A bare `nextly:` tag would over-invalidate; a blank id would never match.
    expect(() => collectionTag("  ")).toThrow(NextlyError);
    expect(() => entryIdTag("posts", "")).toThrow(NextlyError);
    expect(() => entrySlugTag("posts", "")).toThrow(NextlyError);
    expect(() => singleTag("")).toThrow(NextlyError);
  });
});

describe("computeEntryRevalidation", () => {
  it("busts the collection and id tags on a create with no slug or locale", () => {
    expect(computeEntryRevalidation({ collection: "posts", id: "1" })).toEqual({
      tags: ["nextly:posts", "nextly:posts:id:1"],
    });
  });

  it("adds the slug tag when the entry has a slug", () => {
    expect(
      computeEntryRevalidation({ collection: "posts", id: "1", slug: "intro" })
        .tags
    ).toEqual(["nextly:posts", "nextly:posts:id:1", "nextly:posts:slug:intro"]);
  });

  it("adds the id-locale tag only when a locale applied", () => {
    const localized = computeEntryRevalidation({
      collection: "posts",
      id: "1",
      locale: "de",
    });
    expect(localized.tags).toContain("nextly:posts:id:1:de");

    const unlocalized = computeEntryRevalidation({
      collection: "posts",
      id: "1",
    });
    expect(unlocalized.tags.some(t => t.split(":").length > 4)).toBe(false);
  });

  it("busts BOTH the old and new slug tags on a rename", () => {
    const intent = computeEntryRevalidation({
      collection: "posts",
      id: "1",
      slug: "new-slug",
      previousSlug: "old-slug",
    });
    expect(intent.tags).toContain("nextly:posts:slug:new-slug");
    expect(intent.tags).toContain("nextly:posts:slug:old-slug");
  });

  it("does not emit a duplicate slug tag when the slug is unchanged", () => {
    const intent = computeEntryRevalidation({
      collection: "posts",
      id: "1",
      slug: "same",
      previousSlug: "same",
    });
    expect(
      intent.tags.filter(t => t === "nextly:posts:slug:same")
    ).toHaveLength(1);
  });

  it("merges configured extra tags verbatim and de-duplicates", () => {
    const intent = computeEntryRevalidation({
      collection: "posts",
      id: "1",
      extraTags: ["navigation", "nextly:posts"],
    });
    expect(intent.tags).toContain("navigation");
    // `nextly:posts` was already derived, so the extra copy is de-duped away.
    expect(intent.tags.filter(t => t === "nextly:posts")).toHaveLength(1);
  });

  it("ignores blank slug/locale without throwing (optional fields)", () => {
    const intent = computeEntryRevalidation({
      collection: "posts",
      id: "1",
      slug: "",
      locale: "",
    });
    expect(intent.tags).toEqual(["nextly:posts", "nextly:posts:id:1"]);
  });
});

describe("computeSingleRevalidation", () => {
  it("busts the single tag", () => {
    expect(computeSingleRevalidation({ slug: "header" })).toEqual({
      tags: ["nextly:single:header"],
    });
  });

  it("merges extra tags and de-duplicates", () => {
    const intent = computeSingleRevalidation({
      slug: "header",
      extraTags: ["navigation", "navigation"],
    });
    expect(intent.tags).toEqual(["nextly:single:header", "navigation"]);
  });
});
