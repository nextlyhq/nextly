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
});
