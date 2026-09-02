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
        decisions: { reveal: ["e1"], hide: [] },
      })
    ).toBeUndefined();
  });

  it("is a plain comparison when no release is due", () => {
    const only = rendered(
      statusCondition({
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: [], hide: [] },
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
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: ["e1", "e2"], hide: [] },
      })
    );
    expect(widened.params).toEqual(["published", "e1", "e2"]);
    // Still bounded: the widening ADDS ids beside the comparison rather than
    // replacing it, so an unrelated draft stays out.
    expect(widened.sql).toContain('"status"');
    expect(widened.sql).toContain('"id"');
    expect(widened.sql.toLowerCase()).toContain(" or ");
  });

  it("NARROWS a PUBLISHED read by what a due release withdraws", () => {
    // The direction that was missing entirely. The decision said `unpublish`,
    // the id was simply left out of the reveal set, and the ordinary
    // `status = published` comparison went on returning the row the release
    // was supposed to take down.
    const narrowed = rendered(
      statusCondition({
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: [], hide: ["gone"] },
      })
    );
    expect(narrowed.params).toEqual(["published", "gone"]);
    expect(narrowed.sql.toLowerCase()).toContain("not in (");
    // Not an OR: a withdrawal must survive beside the status comparison, and
    // an OR would re-admit every published row regardless.
    expect(narrowed.sql.toLowerCase()).not.toContain(" or ");
  });

  it("applies both directions in one condition", () => {
    // One release publishes some documents and withdraws others in the same
    // pass. A condition carrying only whichever half was written last would
    // pass each single-direction case above.
    const both = rendered(
      statusCondition({
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: ["new"], hide: ["gone"] },
      })
    );
    expect(both.params).toEqual(["published", "gone", "new"]);
    expect(both.sql.toLowerCase()).toContain("not in (");
    expect(both.sql.toLowerCase()).toContain(" or ");
  });

  it("does NOT withdraw from a draft-only read", () => {
    // A draft read is asking for pending work. A document a release is about
    // to withdraw is not pending work, and removing it here would answer a
    // question nobody asked — the mirror of the reveal rule below.
    const draft = rendered(
      statusCondition({
        filter: { values: ["draft"], isPublicRead: false },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: [], hide: ["gone"] },
      })
    );
    expect(draft.params).toEqual(["draft"]);
    expect(draft.sql.toLowerCase()).not.toContain("in (");
  });

  it("does NOT widen a draft-only read", () => {
    // A draft read is asking for pending work. A document a release is about to
    // publish is not pending work, and adding it would answer a question nobody
    // asked — while also showing a published-bound row to a draft listing.
    const draft = rendered(
      statusCondition({
        filter: { values: ["draft"], isPublicRead: false },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: ["e1"], hide: [] },
      })
    );
    expect(draft.params).toEqual(["draft"]);
  });

  it("widens a public read whatever the state is CALLED", () => {
    // What a literal cannot do. A team names its public state `live` and the
    // release machinery must keep working: a due publication is still due, and
    // a comparison against the word `published` would silently stop revealing
    // it — the row simply never appears, on a query that returns rows and
    // looks like it worked. Nothing here mentions a state name, which is the
    // property: the filter says whether the read is public and the condition
    // believes it.
    const widened = rendered(
      statusCondition({
        filter: { values: ["live"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: ["e1"], hide: ["gone"] },
      })
    );
    expect(widened.params).toEqual(["live", "gone", "e1"]);
    expect(widened.sql.toLowerCase()).toContain(" or ");
    expect(widened.sql.toLowerCase()).toContain("not in (");
  });

  it("treats several public states as a SET, not as one of them", () => {
    /*
     * The widening phase 1 refused to attempt. A workflow may call more than
     * one state public — `published` and a `featured` that is also live — and
     * an equality would silently drop every row in the second from public
     * reads. Phase 1 threw rather than emit that query; this is the predicate
     * that makes the refusal unnecessary.
     */
    const both = rendered(
      statusCondition({
        filter: { values: ["published", "featured"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: [], hide: [] },
      })
    );
    expect(both.params).toEqual(["published", "featured"]);
    expect(both.sql.toLowerCase()).toContain(" in (");
  });

  it("keeps a single state an EQUALITY rather than a one-element set", () => {
    // The control, and a deliberate property: every workflow that exists before
    // a team writes its own names one public state, so this widening has to be
    // invisible to them — same SQL, same plan, same rendered parameters.
    const one = rendered(
      statusCondition({
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: [], hide: [] },
      })
    );
    expect(one.params).toEqual(["published"]);
    expect(one.sql.toLowerCase()).not.toContain(" in (");
  });

  it("leaves a NON-public read alone whatever ITS state is called", () => {
    // The control for the rename case: what changed the answer is the filter's
    // own statement about the read, not the mere fact that an unfamiliar word
    // was passed in. `working` is not public, so it is treated as `draft` is.
    const pending = rendered(
      statusCondition({
        filter: { values: ["working"], isPublicRead: false },
        statusColumn: table.status,
        idColumn: table.id,
        decisions: { reveal: ["e1"], hide: ["gone"] },
      })
    );
    expect(pending.params).toEqual(["working"]);
    expect(pending.sql.toLowerCase()).not.toContain(" or ");
  });

  it("stays a plain comparison when the table has no identity column to match", () => {
    // The control for the widening: without an id column there is nothing to
    // match ids against, and emitting a half-built OR would widen the read to
    // everything rather than to the named documents.
    const noId = rendered(
      statusCondition({
        filter: { values: ["published"], isPublicRead: true },
        statusColumn: table.status,
        idColumn: undefined,
        decisions: { reveal: ["e1"], hide: [] },
      })
    );
    expect(noId.params).toEqual(["published"]);
    expect(noId.sql).toContain('"status"');
  });
});
