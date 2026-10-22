import { describe, expect, it } from "vitest";

import { MODES, TRANSLATABLE_COLUMNS, articleData, authorData, localesOf, siteFor } from "./fixture.mjs";
import { seededRandom } from "./stats.mjs";

/** Builders that return what they were given, tagged, so a site's shape can be read without Nextly. */
const builder = kind => input => ({ kind, ...input });
const config = Object.fromEntries(
  ["defineCollection", "defineFieldGroup", "checkbox", "date", "fieldGroup", "number", "relationship", "richText", "text", "textarea"].map(name => [name, builder(name)])
);

const articles = site => site.collections.find(c => c.slug === "articles");
const card = site => site.fieldGroups.find(g => g.slug === "card");

describe("the benchmark site, by storage mode", () => {
  it("stores everything on the main tables in main mode", () => {
    const site = siteFor("main", config);
    expect(site.localization).toBeUndefined();
    expect(articles(site).localized).toBeUndefined();
    expect(card(site).localized).toBeUndefined();
  });

  it("stores the articles' and the card's translatable fields per language, for one language", () => {
    const site = siteFor("per-language", config);
    expect(site.localization).toEqual({ locales: ["en"], defaultLocale: "en" });
    expect(articles(site).localized).toBe(true);
    expect(card(site).localized).toBe(true);
  });

  it("gives both modes the same fields, so only the storage differs", () => {
    const fields = mode => articles(siteFor(mode, config)).fields.map(f => `${f.kind}:${f.name}`);
    expect(fields("per-language")).toEqual(fields("main"));
    expect(fields("main")).toEqual([
      "text:headline", "textarea:excerpt", "richText:body", "number:views", "date:publishedOn", "checkbox:featured", "relationship:author", "fieldGroup:card",
    ]);
  });

  it("refuses a mode it does not know", () => {
    expect(() => siteFor("json-map", config)).toThrow(RangeError);
    expect(MODES).toEqual(["main", "per-language"]);
  });

  it("names the per-language tables of both the articles and the card", () => {
    expect(TRANSLATABLE_COLUMNS).toEqual({ dc_articles: ["headline", "excerpt", "body"], comp_card: ["heading", "blurb"] });
    expect(localesOf("dc_articles")).toBe("dc_articles_locales");
  });
});

describe("the seeded content", () => {
  const generate = seed => {
    const random = seededRandom(seed);
    const author = authorData(random);
    return { author, article: articleData(random, 3, ["a", "b", "c"]) };
  };

  it("is the same for one seed and differs for another", () => {
    expect(generate(1)).toEqual(generate(1));
    expect(generate(1)).not.toEqual(generate(2));
  });

  it("gives an article its fields at a realistic size", () => {
    const { article } = generate(1);
    expect(article.headline.split(" ").length).toBeGreaterThanOrEqual(6);
    expect(article.body.root.children).toHaveLength(6);
    // A short article's body: about three kilobytes of the editor's JSON.
    expect(JSON.stringify(article.body).length).toBeGreaterThan(2500);
    expect(["a", "b", "c"]).toContain(article.author);
    expect(article.card.heading).toBeTruthy();
    expect(article.publishedOn).toBe(new Date(Date.UTC(2025, 0, 1) + 3 * 3_600_000).toISOString());
  });
});
