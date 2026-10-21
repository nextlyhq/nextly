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
  removingOnFailure,
  translationRows,
} from "./measure.mjs";

const article = { headline: "A headline", body: { root: {} }, author: { id: "a1" }, card: { heading: "Card" } };

describe("the checks a measurement makes before it times anything", () => {
  it("reads a create's id from the item or the record", () => {
    expect(idOf({ item: { id: "x" } })).toBe("x");
    expect(idOf({ id: "y" })).toBe("y");
    expect(() => idOf({ item: {} })).toThrow(/no id/);
  });

  it("counts an article complete only with its translatable fields, author and card", () => {
    expect(isCompleteArticle(article)).toBe(true);
    expect(isCompleteArticle({ ...article, headline: undefined })).toBe(false);
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
    const tables = count => ({ dc_articles_locales: count, comp_card_locales: count });
    expect(() => checkStorage("per-language", 10, tables(10))).not.toThrow();
    expect(() => checkStorage("main", 10, tables(null))).not.toThrow();
    expect(() => checkStorage("per-language", 10, tables(null))).toThrow(/expected 10/);
    expect(() => checkStorage("per-language", 10, { dc_articles_locales: 10, comp_card_locales: null })).toThrow(/comp_card_locales/);
    expect(() => checkStorage("main", 10, tables(10))).toThrow(/expected null/);
  });

  it("counts a table's rows only once it is known to exist, and lets any other failure through", async () => {
    const adapter = (exists, select) => ({ tableExists: async table => exists.includes(table), select });
    const rows = await translationRows(adapter(["dc_articles_locales"], async () => [{}, {}]));
    expect(rows).toEqual({ dc_articles_locales: 2, comp_card_locales: null });
    // A failed read of a table that exists is not an absent table: it fails the attempt.
    const dropped = adapter(["dc_articles_locales", "comp_card_locales"], async () => {
      throw new Error("connection lost");
    });
    await expect(translationRows(dropped)).rejects.toThrow(/connection lost/);
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
