/**
 * The installed `@vercel/functions` accepts the pool this adapter hands it,
 * and waits for the idle timeout the pool was built with.
 *
 * `attachDatabasePool` recognises a pool by its shape: mysql2's promise pool
 * is refused outright, and its callback pool is read as waiting 60 seconds
 * (`vercel-pool.ts` says why). So this reads the real package against a real,
 * never-connected mysql2 pool, through `vercelPoolView` as the adapter hands
 * it: attached, and a released connection makes the function wait out the
 * pool's idle timeout and the adapter's idle sweep, not a minute.
 */
import { attachDatabasePool } from "@vercel/functions/db-connections";
import mysql from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vercelPoolView, type ReleasingPool } from "../vercel-pool";

/** Where `@vercel/functions` reads the current request's `waitUntil`. */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
});

describe("attachDatabasePool and the adapter's mysql2 pool", () => {
  it("attaches the pool and waits out its idle timeout after a release", async () => {
    // A deployed function's environment, and a request in flight.
    vi.stubEnv("VERCEL_URL", "app.example.vercel.app");
    vi.stubEnv("VERCEL_REGION", "iad1");
    const waitUntil = vi.fn();
    Reflect.set(globalThis, REQUEST_CONTEXT, { get: () => ({ waitUntil }) });

    const pool = mysql.createPool({
      uri: "mysql://user:pass@127.0.0.1:1/app",
      connectionLimit: 3,
      maxIdle: 3,
      idleTimeout: 5000,
    });
    const core = pool.pool as unknown as ReleasingPool & {
      emit(event: string, ...args: unknown[]): boolean;
    };
    vi.useFakeTimers();
    try {
      expect(() =>
        attachDatabasePool(vercelPoolView(core, 5000))
      ).not.toThrow();

      core.emit("release", {});

      expect(waitUntil).toHaveBeenCalledTimes(1);
      const waited = waitUntil.mock.calls[0]?.[0] as Promise<void>;
      let settled = false;
      void waited.then(() => {
        settled = true;
      });
      // Still waiting past the idle timeout, while the idle sweep may not
      // have closed the connection yet...
      await vi.advanceTimersByTimeAsync(5900);
      expect(settled).toBe(false);
      // ...and done once the sweep has had its second, well short of 60 s.
      await vi.advanceTimersByTimeAsync(300);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
      await pool.end();
    }
  });
});
