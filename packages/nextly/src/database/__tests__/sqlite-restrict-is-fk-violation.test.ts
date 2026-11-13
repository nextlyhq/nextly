/**
 * A delete SQLite refuses over a key's RESTRICT action is a foreign-key violation.
 *
 * SQLite enforces RESTRICT like a trigger, so the driver reports `SQLITE_CONSTRAINT_TRIGGER`
 * rather than `SQLITE_CONSTRAINT_FOREIGNKEY`, with the same "FOREIGN KEY constraint failed"
 * message. Read as a plain constraint, such a refusal surfaced as an internal error and could not
 * be told apart from any other constraint.
 */
import { describe, expect, it } from "vitest";

import { toDbError } from "../errors";

/** A driver error as better-sqlite3 throws it. */
const sqliteError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("toDbError on SQLite", () => {
  it("reads a RESTRICT refusal as a foreign-key violation", () => {
    expect(
      toDbError(
        "sqlite",
        sqliteError(
          "SQLITE_CONSTRAINT_TRIGGER",
          "FOREIGN KEY constraint failed"
        )
      ).kind
    ).toBe("fk-violation");
  });

  it("still reads the foreign-key code itself as one", () => {
    expect(
      toDbError(
        "sqlite",
        sqliteError(
          "SQLITE_CONSTRAINT_FOREIGNKEY",
          "FOREIGN KEY constraint failed"
        )
      ).kind
    ).toBe("fk-violation");
  });

  it("leaves another trigger's or check's refusal a plain constraint", () => {
    expect(
      toDbError(
        "sqlite",
        sqliteError(
          "SQLITE_CONSTRAINT_TRIGGER",
          "not allowed by the app's trigger"
        )
      ).kind
    ).toBe("constraint");
    expect(
      toDbError(
        "sqlite",
        sqliteError("SQLITE_CONSTRAINT_CHECK", "CHECK constraint failed: rank")
      ).kind
    ).toBe("constraint");
  });
});
