/**
 * What the lifecycle condition becomes once releases are in play.
 *
 * Asserted against the RENDERED SQL rather than the builder object: two
 * conditions built from the same inputs would agree with each other whatever
 * either of them emitted, which proves nothing about the statement the database
 * actually runs.
 *
 * @module lib/__tests__/status-condition.test
 */
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { statusCondition } from "../status-condition";

const table = pgTable("posts", {
  id: text("id").primaryKey(),
  status: text("status"),
});

/**
 * The condition compiled to the statement and parameters a database would
 * receive — the repo's own idiom for asserting SQL. Reading the builder object
 * instead would compare a structure against itself.
 */
const rendered = (
  condition: ReturnType<typeof statusCondition>
): { sql: string; params: unknown[] } => {
  if (condition === undefined) return { sql: "", params: [] };
  const compiled = new PgDialect().sqlToQuery(condition);
  return { sql: compiled.sql, params: compiled.params };
};

describe("statusCondition", () => {
  it("applies no condition to an unbounded read", () => {
    // `status: "all"`, or a trusted caller that said nothing. Such a read
    // already sees every row, so there is nothing for a release to reveal.
    expect(
      statusCondition({
        filter: null,
        statusColumn: table.status,
        idColumn: table.id,
        revealIds: ["e1"],
      })
    ).toBeUndefined();
  });

  it("is a plain comparison when no release is due", () => {
    const only = rendered(
      statusCondition({
        filter: { value: "published" },
        statusColumn: table.status,
        idColumn: table.id,
        revealIds: [],
      })
    );
    expect(only.params).toEqual(["published"]);
    // The premise: it produced a condition at all.
    expect(only.sql).toContain('"status"');
    expect(only.sql).not.toContain("in (");
  });

  it("widens a PUBLISHED read to include what a due release publishes", () => {
    const widened = rendered(
      statusCondition({
        filter: { value: "published" },
        statusColumn: table.status,
        idColumn: table.id,
        revealIds: ["e1", "e2"],
      })
    );
    expect(widened.params).toEqual(["published", "e1", "e2"]);
    // Still bounded: the widening ADDS ids beside the comparison rather than
    // replacing it, so an unrelated draft stays out.
    expect(widened.sql).toContain('"status"');
    expect(widened.sql).toContain('"id"');
    expect(widened.sql.toLowerCase()).toContain(" or ");
  });

  it("does NOT widen a draft-only read", () => {
    // A draft read is asking for pending work. A document a release is about to
    // publish is not pending work, and adding it would answer a question nobody
    // asked — while also showing a published-bound row to a draft listing.
    const draft = rendered(
      statusCondition({
        filter: { value: "draft" },
        statusColumn: table.status,
        idColumn: table.id,
        revealIds: ["e1"],
      })
    );
    expect(draft.params).toEqual(["draft"]);
  });

  it("stays a plain comparison when the table has no identity column to match", () => {
    // The control for the widening: without an id column there is nothing to
    // match ids against, and emitting a half-built OR would widen the read to
    // everything rather than to the named documents.
    const noId = rendered(
      statusCondition({
        filter: { value: "published" },
        statusColumn: table.status,
        idColumn: undefined,
        revealIds: ["e1"],
      })
    );
    expect(noId.params).toEqual(["published"]);
    expect(noId.sql).toContain('"status"');
  });
});
