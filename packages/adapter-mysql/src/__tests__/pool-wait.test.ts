/**
 * The bounded wait in mysql2's queue, on a pool shaped like mysql2's own:
 * `getConnection` hands out a connection, or emits `enqueue` synchronously
 * and holds the request until one is released. The integration suite
 * `packages/nextly/src/database/__tests__/pool-wait-bound.integration.test.ts`
 * runs the same bound against a real server.
 */
import { EventEmitter } from "node:events";

import { POOL_WAIT_TIMEOUT_CODE } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boundPoolWait } from "../pool-wait";

type Callback = (err: Error | null, connection?: FakeConnection) => void;

interface FakeConnection {
  release: ReturnType<typeof vi.fn>;
}

/** A pool of one connection that queues every request while it is out. */
class FakePool extends EventEmitter {
  queue: Callback[] = [];
  free: FakeConnection[] = [{ release: vi.fn() }];

  getConnection(callback: Callback): void {
    const connection = this.free.pop();
    if (connection) {
      process.nextTick(() => callback(null, connection));
      return;
    }
    this.emit("enqueue");
    this.queue.push(callback);
  }

  /** Hands the next queued request a connection, as a release would. */
  serveNext(connection: FakeConnection): void {
    this.queue.shift()?.(null, connection);
  }
}

function bounded(pool: FakePool, boundMs: number): FakePool {
  boundPoolWait(pool, boundMs);
  return pool;
}

describe("a request waiting in mysql2's queue for a connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails with the pool-wait timeout once the bound passes", () => {
    const pool = bounded(new FakePool(), 1000);
    pool.free = [];
    const callback = vi.fn();
    pool.getConnection(callback);

    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    const [error, connection] = callback.mock.calls[0] as [
      { code?: string },
      unknown,
    ];
    expect(error.code).toBe(POOL_WAIT_TIMEOUT_CODE);
    expect(connection).toBeUndefined();
  });

  it("releases a connection that arrives after it gave up, and answers only once", () => {
    const pool = bounded(new FakePool(), 1000);
    pool.free = [];
    const callback = vi.fn();
    pool.getConnection(callback);
    vi.advanceTimersByTime(1000);

    const late: FakeConnection = { release: vi.fn() };
    pool.serveNext(late);

    expect(late.release).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("hands over a connection that arrives in time, and never times it out", () => {
    const pool = bounded(new FakePool(), 1000);
    pool.free = [];
    const callback = vi.fn();
    pool.getConnection(callback);

    const connection: FakeConnection = { release: vi.fn() };
    vi.advanceTimersByTime(500);
    pool.serveNext(connection);
    vi.advanceTimersByTime(5000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, connection);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("starts no timer for a request that never waited in the queue", async () => {
    const pool = bounded(new FakePool(), 1000);
    const callback = vi.fn();
    pool.getConnection(callback);
    // A positive control for "no timer": with one, this would fail it.
    expect(vi.getTimerCount()).toBe(0);
    // The fake pool answers on the next tick, which fake timers leave real.
    await new Promise<void>(resolve => process.nextTick(resolve));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeNull();
    expect(pool.listenerCount("enqueue")).toBe(0);
  });

  it("leaves the pool unbounded for a bound of 0", () => {
    const pool = new FakePool();
    const original = pool.getConnection;
    bounded(pool, 0);
    expect(pool.getConnection).toBe(original);
  });
});
