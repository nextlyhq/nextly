/**
 * Which pattern gives a content type's title and description: the type's own,
 * else the site's default, part by part. The order fills a page's pattern
 * level from it, and a design's SEO panel names the title pattern from it, so
 * the two never disagree about which pattern a page follows.
 */
import { describe, expect, it } from "vitest";

import { NO_RULES, patternsOf, type SiteRules } from "../page-levels";

const rules: SiteRules = {
  ...NO_RULES,
  defaultPatterns: { title: "{Title} | {Site name}", description: "{Excerpt}" },
  patterns: { posts: { title: "{Title} · Field Notes" } },
};

describe("a content type's patterns", () => {
  it("are the type's own where it sets one, else the site's default, part by part", () => {
    expect(patternsOf(rules, "posts")).toEqual({
      title: "{Title} · Field Notes",
      description: "{Excerpt}",
    });
  });

  it("are the site's defaults for a type that sets none", () => {
    expect(patternsOf(rules, "authors")).toEqual({
      title: "{Title} | {Site name}",
      description: "{Excerpt}",
    });
  });

  it("are nothing where neither the type nor the site sets one", () => {
    expect(patternsOf(NO_RULES, "posts")).toEqual({});
  });
});
