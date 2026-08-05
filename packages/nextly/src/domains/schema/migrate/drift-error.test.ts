/**
 * @module domains/schema/migrate/drift-error.test
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect } from "vitest";

import { migrationDriftError } from "./drift-error";

describe("migrationDriftError", () => {
  it("builds a NEXTLY_MIGRATION_DRIFT error with drift items + actions", () => {
    const err = migrationDriftError({
      migration: "20260522_add_summary",
      file: "src/db/migrations/20260522_add_summary.sql",
      driftItems: [
        { kind: "+", detail: "posts.summary present in DB" },
        { kind: "-", detail: "posts.legacy_excerpt absent from DB" },
      ],
    });
    expect(err.code).toBe("NEXTLY_MIGRATION_DRIFT");
    expect(err.statusCode).toBe(409);
    expect(err.publicMessage).toContain("schema drift detected");
    expect(err.publicMessage).toContain("posts.summary present in DB");
    expect(err.publicMessage).toContain("migrate:resolve --applied");
    expect(err.logContext).toMatchObject({
      migration: "20260522_add_summary",
      suggestedActions: ["A", "B", "C"],
    });
  });

  it("names the un-adopted database instead of offering recoveries that cannot work", () => {
    // The compound db:sync case: every difference is a table that already
    // exists, and the migration expected to start from nothing. The generic
    // message offers three recoveries, and on this state ALL THREE refuse —
    // db:sync reports no changes, migrate:resolve fails the snapshot check,
    // and migrate:create detects nothing to capture.
    const err = migrationDriftError({
      migration: "20260805_add_locales",
      file: "src/db/migrations/20260805_add_locales.sql",
      driftItems: [
        { kind: "+", detail: "table 'dc_posts' present in DB" },
        { kind: "+", detail: "table 'dc_categories' present in DB" },
      ],
      looksUnadopted: true,
    });

    expect(err.code).toBe("NEXTLY_MIGRATION_DRIFT");
    expect(err.publicMessage).toContain("not managed by migrations yet");
    expect(err.publicMessage).toContain("migrate:baseline");
    expect(err.publicMessage).toContain("changes nothing in the database");
    // The three recoveries are the wrong advice here and must not appear.
    expect(err.publicMessage).not.toContain("migrate:resolve --applied");
    expect(err.publicMessage).not.toContain("capture_drift");
    expect(err.logContext).toMatchObject({ unadopted: true });
  });

  it("still gives the generic drift advice when a table is MISSING from the DB", () => {
    // One `-` item means the database is not merely un-adopted: something the
    // migration expected is absent, which baselining would not explain. The
    // adoption message must not swallow this case.
    const err = migrationDriftError({
      migration: "20260805_mixed",
      file: "src/db/migrations/20260805_mixed.sql",
      driftItems: [
        { kind: "+", detail: "table 'dc_posts' present in DB" },
        { kind: "-", detail: "table 'dc_tags' absent from DB" },
      ],
    });
    expect(err.publicMessage).toContain("schema drift detected");
    expect(err.publicMessage).toContain("migrate:resolve --applied");
  });
});
