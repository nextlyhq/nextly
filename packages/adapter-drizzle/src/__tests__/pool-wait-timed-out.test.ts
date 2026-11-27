/**
 * The pool-wait timeout every adapter raises, logged where it is raised.
 *
 * A caller that answers the error without passing it on (a check that fails
 * open) would otherwise leave a pool whose connections are all held with
 * nothing in the log. Each adapter's own tests pin that it raises through
 * this; the integration suite
 * `packages/nextly/src/database/__tests__/pool-wait-bound.integration.test.ts`
 * pins the line on each dialect's real driver.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { POOL_WAIT_TIMEOUT_CODE, poolWaitTimedOut } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("poolWaitTimedOut", () => {
  it("warns once on the adapter's logger and returns the pool-wait timeout error", () => {
    const warn = vi.fn();
    const cause = new Error("timeout exceeded when trying to connect");

    const error = poolWaitTimedOut(
      2500,
      { dialect: "PostgreSQL", logger: { warn } },
      cause
    );

    expect(error.code).toBe(POOL_WAIT_TIMEOUT_CODE);
    expect(error.cause).toBe(cause);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "A PostgreSQL request waited 2500 ms for a database connection and none was free"
    );
  });

  it("warns on the console when the adapter has no logger", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    poolWaitTimedOut(1000, { dialect: "SQLite" });

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0]?.[0]).toContain(
      "A SQLite request waited 1000 ms"
    );
  });
});
