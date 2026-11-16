/**
 * A plugin's keyed digests on a PostgreSQL pool of one connection: the first
 * use, which makes the key on a connection of its own, must not wait for a
 * connection it holds itself, and once prepared a digest is taken inside a
 * transaction that holds the pool's only connection.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { MetaService } from "../../domains/meta";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin } from "../plugin-context";
import { digestKeyMetaKey, type KeyedDigests } from "../security/keyed-digest";
import { createTestNextly, type TestNextly } from "../test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";
const NAME = "@test/pool-of-one-digests";

/** How long a request waits for a pooled connection before it is refused. */
const POOL_WAIT_MS = 5_000;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

/** An adapter whose pool holds a single connection, with a bounded wait for it. */
async function connectSingleConnection(): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env, not only passed to createAdapter.
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = POSTGRES_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: POSTGRES_URL,
    pool: { max: 1, connectionTimeoutMs: POOL_WAIT_MS },
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

/** `work`, or a named failure once `ms` pass: a hang fails rather than stalls. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          NextlyError.internal({
            logContext: { reason: "pool-of-one-timeout", timeoutMs: ms },
          })
        ),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe.skipIf(!POSTGRES_URL)(
  "a plugin's keyed digests on a PostgreSQL pool of one connection",
  () => {
    let handle: TestNextly | undefined;
    let digests: KeyedDigests | undefined;

    beforeAll(async () => {
      const adapter = await connectSingleConnection();
      handle = await createTestNextly({
        adapter,
        plugins: [
          definePlugin({
            name: NAME,
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(ctx) {
              digests = ctx.security.digests;
            },
          }),
        ],
      });
    }, 60_000);

    afterAll(async () => {
      if (!handle) return;
      // The key this suite made, on the worker's shared database.
      await new MetaService(handle.adapter, silent as never).delete(
        digestKeyMetaKey(NAME)
      );
      // Bounded: a case that hung can still hold the pool's only connection.
      await withTimeout(handle.destroy(), 15_000);
    }, 30_000);

    it("makes the key without waiting for its own connection", async () => {
      await expect(withTimeout(digests!.prepare(), 15_000)).resolves.toBe(
        undefined
      );
    });

    it("then digests inside a transaction holding the only connection", async () => {
      const outside = await withTimeout(
        digests!.digest("email", "ada@example.com"),
        15_000
      );
      await expect(
        withTimeout(
          handle!.adapter.transaction(() =>
            digests!.digest("email", "ada@example.com")
          ),
          15_000
        )
      ).resolves.toBe(outside);
    });
  }
);
