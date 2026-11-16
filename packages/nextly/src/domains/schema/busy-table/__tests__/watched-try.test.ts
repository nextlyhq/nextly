/**
 * A try whose statement stopped waiting while its session still holds the pool's only
 * connection: the watch must not borrow a second one to name the holder, which would wait behind
 * that session for good. It says the holder could not be read instead, at once.
 */
import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { watchTry } from "../watched-try";

/** A PostgreSQL adapter whose pool holds one connection, taken: every pooled ask waits for good. */
function poolOfOneTaken(): DrizzleAdapter {
  return {
    getDrizzle: () => ({ $client: { options: { max: 1 } } }),
    queryStatement: () => new Promise(() => undefined),
  } as unknown as DrizzleAdapter;
}

/** PostgreSQL's lock_timeout: the statement stopped waiting for a lock. */
const lockTimeout = Object.assign(new Error("lock timeout"), { code: "55P03" });

describe("watchTry on a pool with no connection to spare", () => {
  it("names the holder as unreadable rather than waiting for a connection", async () => {
    const watch = watchTry(poolOfOneTaken(), "postgresql", 1000);
    watch.onSession("4242");
    const holder = await watch.ended(lockTimeout);
    expect(holder).toEqual({
      kind: "named",
      sessions: [],
      unreadable: [expect.stringContaining("could not be read")],
    });
  }, 5000);

  it("lets any other failure through", async () => {
    const watch = watchTry(poolOfOneTaken(), "postgresql", 1000);
    watch.onSession("4242");
    expect(await watch.ended(new Error("syntax"))).toBeUndefined();
  }, 5000);
});
