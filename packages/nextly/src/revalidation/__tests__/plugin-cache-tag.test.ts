/**
 * A plugin's cache tags: one spelling for the read that carries a tag and the
 * expiry that clears it, in a namespace no content tag can reach.
 */
import { describe, expect, it } from "vitest";

import { SLUG_PATTERN } from "../../shared/slug-pattern";
import {
  MAX_TAG_LENGTH,
  collectionTag,
  entryIdTag,
  entrySlugTag,
  pluginCacheTag,
  singleTag,
} from "../compute-tags";

describe("pluginCacheTag", () => {
  it("spells a plugin's tag under its own name", () => {
    expect(pluginCacheTag("@nextlyhq/plugin-seo", "settings")).toBe(
      "nextly:@plugin:@nextlyhq/plugin-seo:settings"
    );
    expect(pluginCacheTag("seo", "pattern:posts")).toBe(
      "nextly:@plugin:seo:pattern:posts"
    );
  });

  it("gives two plugins, and two parts, different tags", () => {
    expect(pluginCacheTag("a", "settings")).not.toBe(
      pluginCacheTag("b", "settings")
    );
    expect(pluginCacheTag("a", "settings")).not.toBe(
      pluginCacheTag("a", "redirects")
    );
  });

  it("can never be spelled by a collection's or a Single's tag", () => {
    // Every content tag starts `nextly:` followed by a slug, and a slug starts
    // with a lowercase letter: a plugin's tag starts `nextly:@`.
    expect(SLUG_PATTERN.test("@plugin")).toBe(false);
    for (const slug of ["plugin", "id", "slug", "settings"]) {
      for (const tag of [
        collectionTag(slug),
        entryIdTag(slug, "1"),
        entrySlugTag(slug, "settings"),
        singleTag(slug),
      ]) {
        expect(tag.startsWith("nextly:@")).toBe(false);
      }
      expect(pluginCacheTag(slug, "id:1")).not.toBe(entryIdTag("plugin", "1"));
    }
  });

  it("refuses a blank name or part, and a name that would end its segment early", () => {
    expect(() => pluginCacheTag("", "settings")).toThrow();
    expect(() => pluginCacheTag("seo", "   ")).toThrow();
    // A name holding the separator could spell another plugin's tag:
    // "a:b" with "c" would read as plugin "a" and part "b:c".
    expect(() => pluginCacheTag("a:b", "c")).toThrow();
  });

  it("trims each segment, so a read and its expiry agree however they were typed", () => {
    expect(pluginCacheTag(" seo ", " settings ")).toBe(
      pluginCacheTag("seo", "settings")
    );
  });

  it("stays within the length a cache keeps, hashing a long part the same way each time", () => {
    const long = "x".repeat(400);
    const tag = pluginCacheTag("seo", long);
    expect(tag.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(tag).toBe(pluginCacheTag("seo", long));
    expect(tag.startsWith("nextly:@plugin:seo:h:")).toBe(true);
    expect(tag).not.toBe(pluginCacheTag("seo", "y".repeat(400)));
    // A name long enough to fill the tag by itself is hashed too.
    const named = pluginCacheTag("n".repeat(300), "settings");
    expect(named.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(named).not.toBe(pluginCacheTag("m".repeat(300), "settings"));
  });
});
