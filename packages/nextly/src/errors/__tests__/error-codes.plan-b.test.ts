/**
 * @module errors/__tests__/error-codes.plan-b
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../error-codes";

describe("Plan B error codes", () => {
  it("registers the legacy-bookkeeping + upgrade codes with sensible statuses", () => {
    expect(NEXTLY_ERROR_STATUS.NEXTLY_LEGACY_BOOKKEEPING_DETECTED).toBe(409);
    expect(NEXTLY_ERROR_STATUS.NEXTLY_UPGRADE_TABLE_NAME_COLLISION).toBe(409);
    expect(NEXTLY_ERROR_STATUS.NEXTLY_UPGRADE_IN_PROGRESS).toBe(409);
  });
});
