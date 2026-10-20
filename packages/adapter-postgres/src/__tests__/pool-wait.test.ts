/**
 * pg-pool's queue-wait timeout, reported with the adapters' own code.
 *
 * pg-pool bounds the wait itself; these pin which of its failures become the
 * pool-wait timeout and which pass through untouched, on both of its calling
 * conventions. The integration suite
 * `packages/nextly/src/database/__tests__/pool-wait-bound.integration.test.ts`
 * makes the installed pg-pool raise the real one, so a reworded message
 * fails there.
 */
import { POOL_WAIT_TIMEOUT_CODE } from "@nextlyhq/adapter-drizzle/types";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { reportPoolWaitTimeout } from "../pool-wait";

const QUEUE_TIMEOUT = "timeout exceeded when trying to connect";

/** A pool whose `connect` fails with `error`, in either convention. */
function failingPool(error: Error): Pool {
  return {
    connect: vi.fn((callback?: (err: Error) => void) => {
      if (callback) return callback(error);
      return Promise.reject(error);
    }),
  } as unknown as Pool;
}

describe("a pg pool's failure to hand out a connection", () => {
  it("becomes the pool-wait timeout when the queue wait ran out", async () => {
    const driverError = new Error(QUEUE_TIMEOUT);
    const pool = reportPoolWaitTimeout(failingPool(driverError), 1000);

    const error = (await pool.connect().catch((e: unknown) => e)) as {
      code?: string;
      cause?: unknown;
    };
    expect(error.code).toBe(POOL_WAIT_TIMEOUT_CODE);
    expect(error.cause).toBe(driverError);
  });

  it("becomes the pool-wait timeout through the callback convention pg-pool's query uses", () => {
    const pool = reportPoolWaitTimeout(
      failingPool(new Error(QUEUE_TIMEOUT)),
      1000
    );
    const callback = vi.fn();
    (pool.connect as unknown as (cb: typeof callback) => void)(callback);
    expect((callback.mock.calls[0][0] as { code?: string }).code).toBe(
      POOL_WAIT_TIMEOUT_CODE
    );
  });

  it("leaves a connection that could not be opened as pg-pool reported it", async () => {
    // A database that cannot be reached is not busy.
    const handshake = new Error(
      "Connection terminated due to connection timeout"
    );
    const pool = reportPoolWaitTimeout(failingPool(handshake), 1000);
    await expect(pool.connect()).rejects.toBe(handshake);
  });

  it("passes a connection through when there is one", async () => {
    const client = { query: vi.fn() };
    const pool = reportPoolWaitTimeout(
      { connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool,
      1000
    );
    await expect(pool.connect()).resolves.toBe(client);
  });
});
