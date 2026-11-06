import { describe, expect, it } from "vitest";

import { MODES, TRANSLATABLE_FIELDS, articleData, authorData, localesOf, siteFor, storageContractOf } from "./fixture.mjs";
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
    expect(site.perLanguageStorage).toBeUndefined();
  });

  it("stores them per language in e4 mode by the site-wide option, with nothing marked translatable", () => {
    const site = siteFor("e4", config);
    // The test harness's option, which measure.mjs hands it with the rest of the site.
    expect(site.perLanguageStorage).toBe(true);
    expect(site.localization).toBeUndefined();
    expect(articles(site).localized).toBeUndefined();
    expect(card(site).localized).toBeUndefined();
    expect(siteFor("main", config).perLanguageStorage).toBeUndefined();
  });


  it("gives every mode the same fields, so only the storage differs", () => {
    const fields = mode => articles(siteFor(mode, config)).fields.map(f => `${f.kind}:${f.name}`);
    expect(fields("per-language")).toEqual(fields("main"));
    expect(fields("e4")).toEqual(fields("main"));
    expect(fields("main")).toEqual([
      "text:headline", "textarea:excerpt", "richText:body", "number:views", "date:publishedOn", "checkbox:featured", "relationship:author", "fieldGroup:card",
    ]);
  });

  it("refuses a mode it does not know", () => {
    expect(() => siteFor("json-map", config)).toThrow(RangeError);
    expect(MODES).toEqual(["main", "per-language", "e4"]);
  });

  it("reads every translatable field off the site's own definition, with the type a read returns it as", () => {
    expect(TRANSLATABLE_FIELDS).toEqual({
      dc_authors: { name: "string", bio: "string" },
      dc_articles: { headline: "string", excerpt: "string", body: "object" },
      comp_card: { heading: "string", blurb: "string" },
    });
  });

  it("states how every mode stores every table with translatable fields", () => {
    const stored = (authors, articles, card) => ({
      dc_authors: { columns: ["name", "bio"], perLanguage: authors },
      dc_articles: { columns: ["headline", "excerpt", "body"], perLanguage: articles },
      comp_card: { columns: ["heading", "blurb"], perLanguage: card },
    });
    // main keeps every one on its own table.
    expect(storageContractOf("main")).toEqual(stored(false, false, false));
    // per-language moves those of the entities it marks translatable, and leaves the authors.
    expect(storageContractOf("per-language")).toEqual(stored(false, true, true));
    // e4 moves every translatable field, the authors' among them.
    expect(storageContractOf("e4")).toEqual(stored(true, true, true));
    expect(MODES.map(mode => Object.keys(storageContractOf(mode)))).toEqual(MODES.map(() => Object.keys(TRANSLATABLE_FIELDS)));
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
