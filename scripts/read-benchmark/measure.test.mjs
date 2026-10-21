import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_API_KEYS_CONFIG } from "../../packages/nextly/src/shared/types/config";

import {
  KEY_REQUESTS_PER_HOUR,
  PAGE_SIZE,
  checkKeyBudget,
  checkShape,
  checkStorage,
  idOf,
  isCompleteArticle,
  optionsFrom,
  readsFor,
  removingOnFailure,
  storageOf,
  teardown,
} from "./measure.mjs";

const article = { headline: "A headline", excerpt: "An excerpt.", body: { root: {} }, author: { id: "a1" }, card: { heading: "Card" } };

describe("the checks a measurement makes before it times anything", () => {
  it("reads a create's id from the item or the record", () => {
    expect(idOf({ item: { id: "x" } })).toBe("x");
    expect(idOf({ id: "y" })).toBe("y");
    expect(() => idOf({ item: {} })).toThrow(/no id/);
  });

  it("counts an article complete only with its translatable fields, author and card", () => {
    expect(isCompleteArticle(article)).toBe(true);
    expect(isCompleteArticle({ ...article, headline: undefined })).toBe(false);
    expect(isCompleteArticle({ ...article, excerpt: undefined })).toBe(false);
    expect(isCompleteArticle({ ...article, body: null })).toBe(false);
    expect(isCompleteArticle({ ...article, author: "a1" })).toBe(false);
    // A relationship that failed to populate comes back null, which is also an "object".
    expect(isCompleteArticle({ ...article, author: null })).toBe(false);
    expect(isCompleteArticle({ ...article, author: [] })).toBe(false);
    expect(isCompleteArticle({ ...article, card: {} })).toBe(false);
  });

  it("wants a full page from a list read and a complete article from both", () => {
    const page = Array.from({ length: PAGE_SIZE }, () => article);
    expect(() => checkShape("direct list", { items: page })).not.toThrow();
    expect(() => checkShape("rest list", { items: page.slice(1) })).toThrow(/items, not/);
    expect(() => checkShape("direct list", { items: [{}, ...page.slice(1)] })).toThrow(/without its fields/);
    // Every article of the page, not only the first.
    expect(() => checkShape("rest list", { items: [...page.slice(1), { ...article, author: null }] })).toThrow(/without its fields/);
    expect(() => checkShape("direct detail", article)).not.toThrow();
    expect(() => checkShape("rest detail", { item: article })).not.toThrow();
    expect(() => checkShape("rest detail", { item: {} })).toThrow(/without its fields/);
  });

  it("refuses a site whose storage is not its mode's", () => {
    // What each mode stores, as the two sites store it.
    const asMain = {
      dc_articles: { columns: ["id", "headline", "excerpt", "body", "views"], locales: null },
      comp_card: { columns: ["id", "heading", "blurb"], locales: null },
    };
    const asPerLanguage = {
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
  });

  it("reads each table's columns and its translation table's, and lets any failure through", async () => {
    const tables = {
      dc_articles: [{ id: 1, views: 3 }],
      dc_articles_locales: [{ _parent: 1, headline: "h" }, { _parent: 2, headline: "i" }],
      comp_card: [{ id: 1 }],
    };
    const adapter = {
      tableExists: async table => table in tables,
      select: async table => tables[table],
    };
    expect(await storageOf(adapter)).toEqual({
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
    // The defaults: 300 warm-up, the shape check and 600 timed reads, 901 requests.
    expect(() => checkKeyBudget(optionsFrom(["--mode", "main", "--dialect", "sqlite"]))).not.toThrow();
    expect(() => checkKeyBudget({ warmup: 300, restIterations: KEY_REQUESTS_PER_HOUR - 300 - 1 })).not.toThrow();
    expect(() => checkKeyBudget({ warmup: 300, restIterations: KEY_REQUESTS_PER_HOUR - 300 })).toThrow(new RegExp(`over its ${KEY_REQUESTS_PER_HOUR} an hour`));
  });
});
