/**
 * A localized sort reads one language when fallback is off. SQLite refuses
 * `COALESCE` with a single argument, so that read must not wrap its one value
 * in it; with fallback on, the languages are tried in order.
 */
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildLocalizedOrderExpr } from "../companion-join";

const posts = pgTable("dc_posts", { id: text("id").primaryKey() });

const render = (localeChain: string[]): string =>
  new PgDialect().sqlToQuery(
    buildLocalizedOrderExpr({
      companionTableName: "dc_posts_locales",
      mainIdColumn: posts.id,
      column: "title",
      localeChain,
    })
  ).sql;

describe("buildLocalizedOrderExpr", () => {
  it("reads one language without COALESCE", () => {
    const one = render(["fr"]);
    expect(one).not.toContain("COALESCE");
    expect(one.startsWith("NULLIF(")).toBe(true);
  });

  it("CONTROL: tries several languages in order through COALESCE", () => {
    expect(render(["fr", "en"]).startsWith("COALESCE(NULLIF(")).toBe(true);
  });
});
