import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_API_KEYS_CONFIG } from "../../packages/nextly/src/shared/types/config";

import {
  KEY_REQUESTS_PER_HOUR,
  PAGE_SIZE,
  checkContent,
  checkEveryPage,
  checkKeyBudget,
  checkStorage,
  expectedArticles,
  idOf,
  optionsFrom,
  readsFor,
  removingOnFailure,
  seedSite,
  seededContent,
  storageOf,
  teardown,
} from "./measure.mjs";

// Two pages of seeded articles, as the benchmark seeds them, and the content each must read back as.
const content = seededContent({ seed: 1, docs: 2 * PAGE_SIZE });
const ids = content.articles.map((_, i) => `a${i}`);
const expected = expectedArticles(content, ids);

/**
 * Article `i` as a read returns it: its seeded values, with the ids and times a read adds beside
 * them, and its date spelled otherwise than it was seeded.
 */
function readBack(i) {
  const seeded = expected.get(ids[i]);
  const added = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
  return {
    ...seeded,
    ...added,
    id: ids[i],
    publishedOn: seeded.publishedOn.replace("Z", "+00:00"),
    author: { ...seeded.author, ...added, id: `author-${i}` },
    card: { ...seeded.card, id: `card-${i}` },
  };
}

/** Page `page` of the seeded articles, as a list read returns it. */
function pageOf(page) {
  const first = (page - 1) * PAGE_SIZE;
  return { items: ids.slice(first, first + PAGE_SIZE).map((_, i) => readBack(first + i)) };
}

describe("the checks a measurement makes before it times anything", () => {
  it("reads a create's id from the item or the record", () => {
    expect(idOf({ item: { id: "x" } })).toBe("x");
    expect(idOf({ id: "y" })).toBe("y");
    expect(() => idOf({ item: {} })).toThrow(/no id/);
  });

  it("seeds exactly the content it expects, each article pointing at its author", async () => {
    // The same seed makes the same content, so a measurement's expectation is its seeding's.
    expect(seededContent({ seed: 1, docs: 2 * PAGE_SIZE })).toEqual(content);
    const creates = [];
    const nextly = { create: async ({ collection, data }) => (creates.push({ collection, data }), { item: { id: `${collection}-${creates.length}` } }) };
    const articleIds = await seedSite(nextly, content);
    expect(creates.filter(({ collection }) => collection === "authors").map(({ data }) => data)).toEqual(content.authors);
    const articles = creates.filter(({ collection }) => collection === "articles");
    const withoutAuthor = ({ author: _author, ...values }) => values;
    expect(articles.map(({ data }) => withoutAuthor(data))).toEqual(content.articles.map(withoutAuthor));
    // Each article's author is the id its author was created with.
    expect(articles.map(({ data }) => data.author)).toEqual(content.articles.map(article => `authors-${article.author + 1}`));
    expect(articleIds).toEqual(articles.map((_, i) => `articles-${content.authors.length + i + 1}`));
    // What each must read back as carries its author's values.
    expect(expected.get("a0").author).toEqual(content.authors[content.articles[0].author]);
  });

  it("takes an article that reads back as seeded, whatever a read adds beside it", () => {
    expect(() => checkContent("direct detail", readBack(0), expected)).not.toThrow();
    expect(() => checkContent("rest detail", { item: readBack(1) }, expected)).not.toThrow();
    expect(() => checkContent("direct list", pageOf(1), expected)).not.toThrow();
    expect(() => checkContent("rest list", pageOf(2), expected)).not.toThrow();
  });

  it("refuses an article whose content is not what was seeded, at any depth", () => {
    const article = readBack(0);
    // An empty translated value, of the article's card.
    expect(() => checkContent("direct detail", { ...article, card: { ...article.card, heading: "" } }, expected)).toThrow(/at card\.heading/);
    // A dropped value, of the populated author.
    const { name: _name, ...nameless } = article.author;
    expect(() => checkContent("rest detail", { item: { ...article, author: nameless } }, expected)).toThrow(/at author\.name/);
    // The right field from the wrong row: another article's headline served for this one.
    expect(() => checkContent("direct detail", { ...article, headline: readBack(1).headline }, expected)).toThrow(/a0 with other content than seeded, at headline/);
    // An empty rich-text body, and one short of a paragraph.
    expect(() => checkContent("direct detail", { ...article, body: {} }, expected)).toThrow(/at body\.root/);
    const children = article.body.root.children.slice(1);
    expect(() => checkContent("direct detail", { ...article, body: { root: { ...article.body.root, children } } }, expected)).toThrow(/at body\.root\.children/);
    // An author left unpopulated, a shared value changed, and a date naming another time.
    expect(() => checkContent("direct detail", { ...article, author: "author-0" }, expected)).toThrow(/at author: expected a record/);
    expect(() => checkContent("direct detail", { ...article, views: article.views + 1 }, expected)).toThrow(/at views/);
    expect(() => checkContent("direct detail", { ...article, publishedOn: "2024-01-01T00:00:00.000Z" }, expected)).toThrow(/at publishedOn/);
    // An article the site never seeded.
    expect(() => checkContent("direct detail", { ...article, id: "zz" }, expected)).toThrow(/did not seed/);
    // Every article of a page, not only the first, and a page that is full.
    const page = pageOf(1);
    page.items[PAGE_SIZE - 1] = { ...page.items[PAGE_SIZE - 1], excerpt: "" };
    expect(() => checkContent("rest list", page, expected)).toThrow(/at excerpt/);
    expect(() => checkContent("direct list", { items: pageOf(1).items.slice(1) }, expected)).toThrow(/items, not/);
  });

  it("walks every list page before timing, and refuses one that loses or repeats an article", async () => {
    const asked = [];
    const site = pages => ({ find: async query => (asked.push(query), pages(query.page)) });
    await checkEveryPage(site(pageOf), expected);
    expect(asked.map(({ page }) => page)).toEqual([1, 2]);
    expect(asked[0]).toMatchObject({ collection: "articles", limit: PAGE_SIZE, sort: "publishedOn", depth: 1 });
    // A page that serves an article of the first page again no longer holds every article once.
    const repeated = page => (page === 2 ? { items: [readBack(0), ...pageOf(2).items.slice(1)] } : pageOf(page));
    await expect(checkEveryPage(site(repeated), expected)).rejects.toThrow(/held 39 of the 40/);
    // A swapped value on the last page, which no timed read's first answer may reach.
    const swapped = page => (page === 2 ? { items: [...pageOf(2).items.slice(0, -1), { ...readBack(39), headline: readBack(38).headline }] } : pageOf(page));
    await expect(checkEveryPage(site(swapped), expected)).rejects.toThrow(/a39 with other content than seeded, at headline/);
  });

  it("refuses a site whose storage is not its mode's", () => {
    // What each mode stores, as the two sites store it.
    const authorsOnMain = { columns: ["id", "name", "bio"], locales: null };
    const asMain = {
      dc_authors: authorsOnMain,
      dc_articles: { columns: ["id", "headline", "excerpt", "body", "views"], locales: null },
      comp_card: { columns: ["id", "heading", "blurb"], locales: null },
    };
    // per-language marks the articles and the card translatable, and leaves the authors on their table.
    const asPerLanguage = {
      dc_authors: authorsOnMain,
      dc_articles: { columns: ["id", "views"], locales: { rows: 10, columns: ["_parent", "_locale", "headline", "excerpt", "body"] } },
      comp_card: { columns: ["id"], locales: { rows: 10, columns: ["_parent", "_locale", "heading", "blurb"] } },
    };
    const articles = (storage, change) => ({ ...storage, dc_articles: { ...storage.dc_articles, ...change } });
    expect(() => checkStorage("main", 10, asMain)).not.toThrow();
    expect(() => checkStorage("per-language", 10, asPerLanguage)).not.toThrow();
    expect(() => checkStorage("main", 10, asPerLanguage)).toThrow(/translation table/);
    expect(() => checkStorage("main", 10, articles(asMain, { columns: ["id", "headline", "body"] }))).toThrow(/lacks excerpt/);
    expect(() => checkStorage("per-language", 10, asMain)).toThrow(/no translation table/);
    const fewer = articles(asPerLanguage, { locales: { ...asPerLanguage.dc_articles.locales, rows: 9 } });
    expect(() => checkStorage("per-language", 10, fewer)).toThrow(/9 translation rows, expected 10/);
    // Rows in the right tables are not enough: the columns must be there too.
    const kept = articles(asPerLanguage, { columns: ["id", "views", "excerpt"] });
    expect(() => checkStorage("per-language", 10, kept)).toThrow(/excerpt/);
    const moved = articles(asPerLanguage, { locales: { rows: 10, columns: ["_parent", "_locale", "headline", "excerpt", "body", "views"] } });
    expect(() => checkStorage("per-language", 10, moved)).toThrow(/views/);
    // e4 is held to the same storage: a build without its storage option stores it as main does.
    // e4 also moves the authors' name and bio, one translation row per author.
    const authorsPerLanguage = { columns: ["id"], locales: { rows: 20, columns: ["_parent", "_locale", "name", "bio"] } };
    const asE4 = { ...asPerLanguage, dc_authors: authorsPerLanguage };
    expect(() => checkStorage("e4", 10, asE4)).not.toThrow();
    expect(() => checkStorage("e4", 10, { ...asMain, dc_authors: authorsPerLanguage })).toThrow(/^e4 mode: dc_articles has no translation table$/);
    expect(() => checkStorage("e4", 10, { ...fewer, dc_authors: authorsPerLanguage })).toThrow(/9 translation rows, expected 10/);
    const { dc_authors: _unread, ...withoutAuthors } = asE4;
    expect(() => checkStorage("e4", 10, withoutAuthors)).toThrow(/^e4 mode: dc_authors was not read$/);
    expect(() => checkStorage("e4", 10, asPerLanguage)).toThrow(/^e4 mode: dc_authors has no translation table$/);
    expect(() => checkStorage("e4", 10, { ...asPerLanguage, dc_authors: { ...authorsPerLanguage, locales: { ...authorsPerLanguage.locales, rows: 19 } } })).toThrow(
      /dc_authors has 19 translation rows, expected 20/
    );
    // Held both ways: a table a mode keeps on its own table must not have moved. per-language
    // leaves the authors where they are, and main moves nothing.
    expect(() => checkStorage("per-language", 10, asPerLanguage)).not.toThrow();
    expect(() => checkStorage("per-language", 10, asE4)).toThrow(/^per-language mode: dc_authors has a translation table, of 20 rows$/);
    expect(() => checkStorage("main", 10, { ...asMain, dc_authors: authorsPerLanguage })).toThrow(/^main mode: dc_authors has a translation table, of 20 rows$/);
    expect(() => checkStorage("per-language", 10, { ...asPerLanguage, dc_authors: { columns: ["id", "name"], locales: null } })).toThrow(
      /^per-language mode: dc_authors lacks bio$/
    );
  });

  it("reads each table's columns and its translation table's, and lets any failure through", async () => {
    const tables = {
      dc_authors: [{ id: "a1", name: "Ada", bio: "Writes." }],
      dc_articles: [{ id: 1, views: 3 }],
      dc_articles_locales: [{ _parent: 1, headline: "h" }, { _parent: 2, headline: "i" }],
      comp_card: [{ id: 1 }],
    };
    const adapter = {
      tableExists: async table => table in tables,
      select: async table => tables[table],
    };
    // Every table with translatable columns, whatever the mode, so each is held to its contract.
    expect(await storageOf(adapter)).toEqual({
      dc_authors: { columns: ["id", "name", "bio"], locales: null },
      dc_articles: { columns: ["id", "views"], locales: { rows: 2, columns: ["_parent", "headline"] } },
      comp_card: { columns: ["id"], locales: null },
    });
    // A failed read of a table that exists is not an absent table: it fails the attempt.
    const dropped = { tableExists: async () => true, select: async () => Promise.reject(new Error("connection lost")) };
    await expect(storageOf(dropped)).rejects.toThrow(/connection lost/);
    // Nor is a failed question whether it exists, with the main tables still readable.
    const unasked = { ...adapter, tableExists: async () => Promise.reject(new Error("connection lost")) };
    await expect(storageOf(unasked)).rejects.toThrow(/connection lost/);
  });

  it("removes what a boot made when the boot fails, and keeps it when it succeeds", async () => {
    const made = () => mkdtempSync(join(tmpdir(), "read-benchmark-boot-"));
    const failed = made();
    await expect(removingOnFailure(failed, async () => Promise.reject(new Error("boot failed")))).rejects.toThrow(/boot failed/);
    expect(existsSync(failed)).toBe(false);
    const booted = made();
    await expect(removingOnFailure(booted, async () => "handle")).resolves.toBe("handle");
    expect(existsSync(booted)).toBe(true);
    rmSync(booted, { recursive: true, force: true });
  });

  it("reads its options from the command line, with the documented defaults", () => {
    expect(optionsFrom(["--mode", "main", "--dialect", "sqlite"])).toEqual({
      mode: "main", dialect: "sqlite", docs: 1000, iterations: 3000, warmup: 300, restIterations: 600, seed: 1,
    });
    expect(optionsFrom(["--mode", "per-language", "--dialect", "mysql", "--docs", "50", "--seed", "9"])).toMatchObject({ docs: 50, seed: 9 });
  });

  it("tears the site down and removes its folder even when the teardown fails", async () => {
    let removed = 0;
    const failing = { destroy: async () => Promise.reject(new Error("shutdown failed")) };
    await expect(teardown(failing, () => removed++)).rejects.toThrow(/shutdown failed/);
    await teardown({ destroy: async () => {} }, () => removed++);
    expect(removed).toBe(2);
  });

  it("lists in a seeded order, so a page holds the same articles in both modes", async () => {
    // Without a sort a page's articles are the database's choice, and seeded
    // entries take random ids, so one page number could hold other articles
    // in the other mode.
    const finds = [];
    const urls = [];
    const reads = readsFor({
      nextly: { find: async query => (finds.push(query), {}), findByID: async () => ({}) },
      handlers: { GET: async request => (urls.push(new URL(request.url)), { status: 200, json: async () => ({}) }) },
      keys: { list: "k", detail: "k" },
      articleIds: Array.from({ length: 40 }, (_, i) => `a${i}`),
      options: { seed: 1, iterations: 1, restIterations: 1 },
    });
    await reads["direct list"].next();
    await reads["rest list"].next();
    expect(finds[0].sort).toBe("publishedOn");
    expect(urls[0].searchParams.get("sort")).toBe("publishedOn");
  });

  it("budgets each key what Nextly allows one by default", () => {
    // A test boot configures no `apiKeys.rateLimit`, so its keys get the default.
    expect(KEY_REQUESTS_PER_HOUR).toBe(DEFAULT_API_KEYS_CONFIG.requestsPerHour);
  });

  it("keeps each REST read inside one key's hourly allowance, and refuses settings that are not", () => {
    // The defaults: 300 warm-up, the content check and 600 timed reads, 901 requests.
    expect(() => checkKeyBudget(optionsFrom(["--mode", "main", "--dialect", "sqlite"]))).not.toThrow();
    expect(() => checkKeyBudget({ warmup: 300, restIterations: KEY_REQUESTS_PER_HOUR - 300 - 1 })).not.toThrow();
    expect(() => checkKeyBudget({ warmup: 300, restIterations: KEY_REQUESTS_PER_HOUR - 300 })).toThrow(new RegExp(`over its ${KEY_REQUESTS_PER_HOUR} an hour`));
  });
});
