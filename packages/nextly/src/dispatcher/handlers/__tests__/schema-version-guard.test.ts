import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { assertSchemaVersionMatch } from "../schema-version-guard";

describe("assertSchemaVersionMatch", () => {
  it("passes when the expected version matches the stored version", () => {
    expect(() => assertSchemaVersionMatch(3, 3, "hero")).not.toThrow();
  });

  it("passes when no expected version is sent (code-first / HMR source)", () => {
    // A missing expected version means the caller is not doing an optimistic
    // save, so it must not be blocked regardless of the stored version.
    expect(() => assertSchemaVersionMatch(undefined, 7, "hero")).not.toThrow();
  });

  it("throws a version conflict when the expected version is stale", () => {
    expect(() => assertSchemaVersionMatch(3, 5, "hero")).toThrow(NextlyError);
    try {
      assertSchemaVersionMatch(3, 5, "hero");
    } catch (err) {
      expect(NextlyError.isConflict(err)).toBe(true);
    }
  });
});
