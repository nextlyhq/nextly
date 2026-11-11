/**
 * The refusal of a run that lost the schema lock names the last migration it applied, where the
 * caller knows it, so the operator knows where the database stands before running it again.
 */
import { describe, expect, it } from "vitest";

import { lostLockError } from "../schema-lock";

describe("a lost schema lock's refusal", () => {
  it("names the last migration the run applied, before saying to check the database", () => {
    const error = lostLockError("nextly migrate", "0002_add_tags.sql");
    expect(error.publicMessage).toContain(
      "recorded nothing further. The last migration it applied is 0002_add_tags.sql. Check the database"
    );
    expect(error.logContext).toMatchObject({
      reason: "schema lock lost while held",
      lastApplied: "0002_add_tags.sql",
    });
  });

  it("says when the run applied none", () => {
    expect(lostLockError("nextly migrate", null).publicMessage).toContain(
      "It applied no migration before it lost the lock."
    );
  });

  it("says nothing of migrations where the caller has none to name", () => {
    const error = lostLockError("nextly db:sync");
    expect(error.publicMessage).not.toContain("migration it applied");
    expect(error.logContext).not.toHaveProperty("lastApplied");
  });
});
