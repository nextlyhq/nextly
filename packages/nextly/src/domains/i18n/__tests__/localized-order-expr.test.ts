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

/**
 * The expression's shape, each language's read named by its language:
 * `NULLIF(fr)` reads French text, `fr` French as stored, in the order the
 * database tries them.
 */
const shape = (
  localeChain: string[],
  options: { blankIsValue?: boolean; nonText?: boolean } = {}
): string => {
  const query = new PgDialect().sqlToQuery(
    buildLocalizedOrderExpr({
      companionTableName: "dc_posts_locales",
      mainIdColumn: posts.id,
      column: "title",
      localeChain,
      ...options,
    })
  );
  return query.sql
    .replace(/\(SELECT [^()]*?\$(\d+)\)/g, (_, n: string) =>
      String(query.params[Number(n) - 1])
    )
    .replace(/, ''\)/g, ")");
};

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
    // Text in every language first, so French '' never comes before English
    // text; only where no language holds text does the empty string order.
    expect(shape(["en"], { blankIsValue: true })).toBe(
      "COALESCE(NULLIF(en), en)"
    );
    expect(shape(["fr", "en"], { blankIsValue: true })).toBe(
      "COALESCE(NULLIF(fr), NULLIF(en), fr, en)"
    );
  });

  it("CONTROL: a translated entity's empty string falls back, and a non-text value is never blank", () => {
    expect(shape(["fr", "en"])).toBe("COALESCE(NULLIF(fr), NULLIF(en))");
    expect(shape(["fr", "en"], { nonText: true, blankIsValue: true })).toBe(
      "COALESCE(fr, en)"
    );
  });
});
