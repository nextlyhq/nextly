/**
 * What a failed collection delete answers: the refusal itself wherever the
 * rollback was whole, and the part-way message only on MySQL once the delete
 * has reached a statement that can be DDL, which commits what ran before it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { collectionDeleteFailure } from "../collection-delete-failure";

const refusal = NextlyError.conflict({
  message: "A plugin holds this collection.",
});

describe("collectionDeleteFailure", () => {
  it("passes a refusal raised before any DDL on through, on MySQL as elsewhere", () => {
    for (const dialect of ["mysql", "postgresql", "sqlite"] as const) {
      expect(
        collectionDeleteFailure(refusal, ["posts"], {
          dialect,
          ddlStarted: false,
        })
      ).toBe(refusal);
    }
  });

  it("says the delete went part-way on MySQL once DDL may have run", () => {
    const failure = collectionDeleteFailure(refusal, ["posts"], {
      dialect: "mysql",
      ddlStarted: true,
    });

    expect(failure).not.toBe(refusal);
    expect(failure.code).toBe("NEXTLY_MIGRATION_APPLY_FAILED");
    expect(failure.logContext).toMatchObject({
      collections: ["posts"],
      partial: true,
    });
  });

  it("keeps a refusal on PostgreSQL and SQLite after DDL too, where the rollback undoes it", () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      expect(
        collectionDeleteFailure(refusal, ["posts"], {
          dialect,
          ddlStarted: true,
        })
      ).toBe(refusal);
    }
  });

  it("says nothing was removed for a failure that is not a refusal, before any DDL", () => {
    const failure = collectionDeleteFailure(new Error("driver"), ["a", "b"], {
      dialect: "mysql",
      ddlStarted: false,
    });

    expect(failure.code).toBe("NEXTLY_MIGRATION_APPLY_FAILED");
    expect(failure.publicMessage).toBe(
      "Deleting these collections failed, so nothing was removed."
    );
    expect(failure.logContext).toMatchObject({ partial: false });
  });
});
