// F10 PR 5 — pure-formatter tests.

import { describe, expect, it } from "vitest";

import { formatJournalScope, formatJournalSummary } from "../formatters";

describe("formatJournalScope", () => {
  it("renders collection scope as title-cased slug", () => {
    expect(formatJournalScope({ kind: "collection", slug: "posts" })).toBe(
      "Posts"
    );
  });

  it("converts hyphens and underscores in slugs to spaces with title case", () => {
    expect(formatJournalScope({ kind: "collection", slug: "blog-posts" })).toBe(
      "Blog posts"
    );
    expect(formatJournalScope({ kind: "single", slug: "site_settings" })).toBe(
      "Site settings"
    );
  });

  it("renders global scope without slug as 'Global'", () => {
    expect(formatJournalScope({ kind: "global" })).toBe("Global");
  });

  it("renders global scope with slug as title-cased", () => {
    expect(formatJournalScope({ kind: "global", slug: "site" })).toBe("Site");
  });

  it("renders fresh-push scope as 'Fresh setup'", () => {
    expect(formatJournalScope({ kind: "fresh-push" })).toBe("Fresh setup");
  });

  it("renders null scope (legacy row) as 'Schema'", () => {
    expect(formatJournalScope(null)).toBe("Schema");
  });
});

describe("formatJournalSummary", () => {
  it("returns 'no changes' for an all-zero summary", () => {
    expect(
      formatJournalSummary({ added: 0, removed: 0, renamed: 0, changed: 0 })
    ).toBe("no changes");
  });

  it("returns 'Schema apply' for null (legacy row)", () => {
    expect(formatJournalSummary(null)).toBe("Schema apply");
  });

  it("singular field count uses 'field' (no plural)", () => {
    expect(
      formatJournalSummary({ added: 1, removed: 0, renamed: 0, changed: 0 })
    ).toBe("1 field added");
  });

  it("plural field count uses 'fields'", () => {
    expect(
      formatJournalSummary({ added: 3, removed: 0, renamed: 0, changed: 0 })
    ).toBe("3 fields added");
  });

  it("aggregates added + renamed + changed in a fixed order", () => {
    expect(
      formatJournalSummary({ added: 1, removed: 1, renamed: 1, changed: 1 })
    ).toBe("1 field added, 1 renamed, 1 changed, 1 removed");
  });

  it("renders only the non-zero counts", () => {
    expect(
      formatJournalSummary({ added: 0, removed: 0, renamed: 2, changed: 0 })
    ).toBe("2 renamed");
  });
});
