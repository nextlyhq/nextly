/**
 * @module errors/__tests__/error-codes.c2
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../error-codes";

describe("C2 migrate error codes", () => {
  it("registers the migrate codes with sensible statuses", () => {
    expect(NEXTLY_ERROR_STATUS.NEXTLY_MIGRATE_LOCK_BUSY).toBe(409);
    expect(NEXTLY_ERROR_STATUS.NEXTLY_CORE_DESTRUCTIVE_REFUSED).toBe(409);
    expect(NEXTLY_ERROR_STATUS.NEXTLY_MIGRATION_DRIFT).toBe(409);
    expect(NEXTLY_ERROR_STATUS.NEXTLY_MIGRATION_APPLY_FAILED).toBe(500);
  });
});
