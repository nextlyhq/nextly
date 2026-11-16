/**
 * The installed `@vercel/functions` accepts the pool this adapter hands it.
 *
 * `attachDatabasePool` recognises a pool by its shape and throws "Unsupported
 * database pool type" for one it does not know, and the adapter hands it its
 * `pg.Pool` after replacing that pool's `connect` (`reportPoolWaitTimeout`).
 * So this reads the real package against a real, never-connected `pg.Pool`:
 * it is attached, and a released connection makes the function wait out the
 * pool's own idle timeout, which is what keeps a Vercel instance alive until
 * the pool has closed its idle connections.
 */
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportPoolWaitTimeout } from "../pool-wait";

/** Where `@vercel/functions` reads the current request's `waitUntil`. */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
});

describe("attachDatabasePool and the adapter's pool", () => {
  it("attaches the pool and waits out its idle timeout after a release", async () => {
    // A deployed function's environment, and a request in flight.
    vi.stubEnv("VERCEL_URL", "app.example.vercel.app");
    vi.stubEnv("VERCEL_REGION", "iad1");
    const waitUntil = vi.fn();
    Reflect.set(globalThis, REQUEST_CONTEXT, { get: () => ({ waitUntil }) });
    vi.useFakeTimers();

    const pool = reportPoolWaitTimeout(
      new Pool({
        connectionString: "postgres://user:pass@127.0.0.1:1/app",
        max: 3,
        min: 0,
        idleTimeoutMillis: 5000,
      }),
      15000
    );
    try {
      expect(() => attachDatabasePool(pool)).not.toThrow();
      expect(pool.listenerCount("release")).toBe(1);

      pool.emit("release", undefined, {});

      expect(waitUntil).toHaveBeenCalledTimes(1);
      const waited = waitUntil.mock.calls[0]?.[0] as Promise<void>;
      let settled = false;
      void waited.then(() => {
        settled = true;
      });
      // Still waiting just before the pool's idle timeout has passed...
      await vi.advanceTimersByTimeAsync(5000);
      expect(settled).toBe(false);
      // ...and done just after it.
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
