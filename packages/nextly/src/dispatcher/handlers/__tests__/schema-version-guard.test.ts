import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { assertSchemaVersionMatch } from "../schema-version-guard";

describe("assertSchemaVersionMatch", () => {
  it("passes when the expected version matches the stored version", () => {
    expect(() => assertSchemaVersionMatch(3, 3, "hero")).not.toThrow();
  });

  it("rejects a missing expected version instead of skipping the check", () => {
    // The Schema Builder is the only caller and always sends a version, so an
    // omitted one is a malformed request, not a reason to bypass the lock.
    expect.assertions(2);
    expect(() => assertSchemaVersionMatch(undefined, 7, "hero")).toThrow(
      NextlyError
    );
    try {
      assertSchemaVersionMatch(undefined, 7, "hero");
    } catch (err) {
      const data = (err as NextlyError).publicData as {
        errors: Array<{ code: string }>;
      };
      expect(data.errors[0].code).toBe("SCHEMA_VERSION_REQUIRED");
    }
  });

  it("throws a version conflict when the expected version is stale", () => {
    // expect.assertions keeps the isConflict check in the catch load-bearing:
    // if the call ever stops throwing, the test fails instead of passing empty.
    expect.assertions(2);
    expect(() => assertSchemaVersionMatch(3, 5, "hero")).toThrow(NextlyError);
    try {
      assertSchemaVersionMatch(3, 5, "hero");
    } catch (err) {
      expect(NextlyError.isConflict(err)).toBe(true);
    }
  });
});
