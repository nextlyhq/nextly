/**
 * A localized sort reads one language when fallback is off. SQLite refuses
 * `COALESCE` with a single argument, so that read must not wrap its one value
 * in it; with fallback on, the languages are tried in order.
 */
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildLocalizedOrderExpr } from "../companion-join";

const posts = pgTable("dc_posts", { id: text("id").primaryKey() });

const render = (
  localeChain: string[],
  options: { blankIsValue?: boolean; nonText?: boolean } = {}
): string =>
  new PgDialect().sqlToQuery(
    buildLocalizedOrderExpr({
      companionTableName: "dc_posts_locales",
      mainIdColumn: posts.id,
      column: "title",
      localeChain,
      ...options,
    })
  ).sql;

/** How many times `needle` appears in `haystack`. */
const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("buildLocalizedOrderExpr", () => {
  it("reads one language without COALESCE", () => {
    const one = render(["fr"]);
    expect(one).not.toContain("COALESCE");
    expect(one.startsWith("NULLIF(")).toBe(true);
  });

  it("CONTROL: tries several languages in order through COALESCE", () => {
    expect(render(["fr", "en"]).startsWith("COALESCE(NULLIF(")).toBe(true);
  });

  it("orders an untranslated entity's empty string as a value, after any language's text", () => {
    // Text first in every language, then each language's own value, so an
    // empty string is ordered by rather than read as a missing translation.
    const one = render(["en"], { blankIsValue: true });
    expect(one.startsWith("COALESCE(NULLIF(")).toBe(true);
    expect(count(one, "NULLIF(")).toBe(1);
    expect(count(one, "SELECT")).toBe(2);
    const two = render(["fr", "en"], { blankIsValue: true });
    expect(count(two, "NULLIF(")).toBe(2);
    expect(count(two, "SELECT")).toBe(4);
  });

  it("CONTROL: a translated entity's empty string falls back, and a non-text value is never blank", () => {
    expect(count(render(["fr", "en"]), "SELECT")).toBe(2);
    const nonText = render(["fr", "en"], { nonText: true, blankIsValue: true });
    expect(nonText).not.toContain("NULLIF(");
    expect(count(nonText, "SELECT")).toBe(2);
  });
});
