import { PgDialect, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildDrizzleOrderBy } from "../drizzle-order";

/**
 * Every assertion here compiles the clause to SQL TEXT rather than checking that
 * a clause came back.
 *
 * That distinction is the whole reason this file exists. `OrderBySpec.nulls` was
 * declared on a published type and documented as "can be explicitly controlled",
 * and the adapter read it nowhere — so every caller that set it got the dialect
 * default in silence. A test asserting "an order clause was produced" would have
 * passed against that implementation, and so would one asserting the spec object
 * was accepted. Only the rendered SQL can tell a honoured option from an ignored
 * one.
 *
 * Compiled through `PgDialect` to fix one rendering for comparison; the builder
 * composes drizzle helpers and never emits engine-specific text.
 */
const table = pgTable("releases", {
  id: text("id"),
  scheduledAt: timestamp("scheduled_at"),
});

function render(orderBy: Parameters<typeof buildDrizzleOrderBy>[1]): string {
  const clauses = buildDrizzleOrderBy(
    { id: table.id, scheduledAt: table.scheduledAt },
    orderBy
  );
  if (clauses.length === 0) return "";
  const dialect = new PgDialect();
  return clauses.map(c => dialect.sqlToQuery(c).sql).join(", ");
}

describe("buildDrizzleOrderBy", () => {
  it("emits a plain direction when null placement is not asked for", () => {
    // The control for every case below: with no `nulls`, nothing extra appears,
    // so an implementation that always emitted a nullness key would fail here.
    expect(render([{ column: "scheduledAt", direction: "desc" }])).toBe(
      '"releases"."scheduled_at" desc'
    );
  });

  it("puts nulls LAST by sorting on nullness first", () => {
    // `NULLS LAST` is not portable — MySQL rejects it — so the placement is a
    // leading sort key on `col is null`, which all three engines evaluate.
    const sql = render([
      { column: "scheduledAt", direction: "desc", nulls: "last" },
    ]);
    expect(sql).toBe(
      '"releases"."scheduled_at" is null asc, "releases"."scheduled_at" desc'
    );
  });

  it("puts nulls FIRST by inverting that key, not by dropping it", () => {
    const sql = render([
      { column: "scheduledAt", direction: "asc", nulls: "first" },
    ]);
    expect(sql).toBe(
      '"releases"."scheduled_at" is null desc, "releases"."scheduled_at" asc'
    );
  });

  it("keeps the caller's key order across several columns", () => {
    // A flatMap that expanded one spec into two clauses could reorder the rest;
    // the tie-breaker must still come after the primary key.
    const sql = render([
      { column: "scheduledAt", direction: "desc", nulls: "last" },
      { column: "id", direction: "desc" },
    ]);
    expect(sql).toBe(
      '"releases"."scheduled_at" is null asc, "releases"."scheduled_at" desc, "releases"."id" desc'
    );
  });

  it("skips an unknown column rather than failing the query", () => {
    // Ordering is a refinement. A caller naming a column that is not there
    // should get an unordered answer, not a failed statement.
    expect(render([{ column: "nope", direction: "desc" }])).toBe("");
  });
});
