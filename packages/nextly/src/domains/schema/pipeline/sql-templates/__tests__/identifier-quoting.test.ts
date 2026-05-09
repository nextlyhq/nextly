// F11 PR 3: identifier-quoting unit tests.

import { describe, expect, it } from "vitest";

import { quoteIdent } from "../identifier-quoting";

describe("quoteIdent", () => {
  it("PG quotes with double-quotes", () => {
    expect(quoteIdent("dc_posts", "postgresql")).toBe('"dc_posts"');
  });

  it("MySQL quotes with backticks", () => {
    expect(quoteIdent("dc_posts", "mysql")).toBe("`dc_posts`");
  });

  it("SQLite quotes with double-quotes", () => {
    expect(quoteIdent("dc_posts", "sqlite")).toBe('"dc_posts"');
  });

  it("handles hyphenated identifiers (rare but legal in quoted form)", () => {
    expect(quoteIdent("dc-posts", "postgresql")).toBe('"dc-posts"');
  });

  it("handles reserved-word identifiers via the dialect quoting", () => {
    expect(quoteIdent("order", "postgresql")).toBe('"order"');
    expect(quoteIdent("select", "mysql")).toBe("`select`");
  });

  it("throws on names containing the dialect quote char (PG)", () => {
    expect(() => quoteIdent('weird"name', "postgresql")).toThrow(
      /contains the dialect quote character/
    );
  });

  it("throws on names containing the dialect quote char (MySQL)", () => {
    expect(() => quoteIdent("weird`name", "mysql")).toThrow(
      /contains the dialect quote character/
    );
  });

  it("MySQL allows double-quotes (not the MySQL quote char)", () => {
    // backtick is MySQL's identifier quote; double-quote is fine.
    expect(quoteIdent('weird"name', "mysql")).toBe('`weird"name`');
  });
});
