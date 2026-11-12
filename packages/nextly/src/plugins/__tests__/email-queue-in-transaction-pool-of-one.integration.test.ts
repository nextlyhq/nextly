/**
 * A plugin queueing a templated email inside a transaction, on a PostgreSQL
 * pool of one connection: the template is read on the transaction's own
 * connection, so the queue does not wait for the connection its transaction
 * holds, and the email is queued with the transaction.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { emailQueueTableFor } from "../../domains/email/queued-send";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

/** A template the suite saves, whose copy address the queue must capture. */
const TEMPLATE = "pool-of-one-notice";
const COPY = "copies@example.com";

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

describe.skipIf(!POSTGRES_URL)(
  "queueing a templated email inside a transaction on a PostgreSQL pool of one connection",
  () => {
    let handle: TestNextly | undefined;
    let ctx: PluginContext | undefined;
    const queued: string[] = [];
    // Each email as it is about to be sent, its copies included.
    const sent: Array<{ cc?: unknown }> = [];

    beforeAll(async () => {
      const adapter = await connectSingleConnection();
      handle = await createTestNextly({
        adapter,
        plugins: [
          definePlugin({
            name: "@test/pool-of-one-queue",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(captured) {
              ctx = captured;
              captured.filters.add(
                "email.beforeSend",
                (value: { cc?: unknown }) => {
                  sent.push(value);
                  return value;
                }
              );
            },
          }),
        ],
      });
      // Saved with a copy address: the queue takes its copies when the
      // email is queued, which is the read that must use the transaction.
      const templates = handle.getService(
        "emailTemplateService"
      ) as unknown as {
        createTemplate(input: Record<string, unknown>): Promise<unknown>;
      };
      await templates.createTemplate({
        name: "Pool of one notice",
        slug: TEMPLATE,
        subject: "Hello",
        htmlContent: "<p>Hello</p>",
        cc: [COPY],
      });
    }, 60_000);

    afterAll(async () => {
      if (!handle) return;
      // The emails this suite queued, on the worker's shared database.
      const table = emailQueueTableFor("postgresql");
      const db = handle.adapter.getDrizzle() as unknown as {
        delete: (t: typeof table) => {
          where: (condition: unknown) => Promise<unknown>;
        };
      };
      for (const id of queued) {
        await withTimeout(db.delete(table).where(eq(table.id, id)), 15_000);
      }
      await withTimeout(
        handle.adapter.executeQuery(
          `DELETE FROM email_templates WHERE slug = '${TEMPLATE}'`
        ),
        15_000
      );
      // Bounded: a case that hung can still hold the pool's only connection.
      await withTimeout(handle.destroy(), 15_000);
    }, 30_000);

    it("reads the template on the transaction's connection and queues the email", async () => {
      if (!ctx) throw new Error("not booted");
      const { email } = ctx.services;

      const result = await withTimeout(
        // The transaction takes the pool's one connection when it opens and
        // holds it until this work returns; a template read through the pool
        // would wait for it until the pool's wait runs out.
        ctx.db.transaction(tx =>
          email.queueWithTemplate(
            TEMPLATE,
            "ada@example.com",
            { name: "Ada" },
            { tx }
          )
        ),
        POOL_WAIT_MS * 3
      );
      queued.push(result.id);

      expect(result.id).toEqual(expect.any(String));
      expect(result.state).toBe("waiting");
      // The template was read, not passed over: a lookup that failed on the
      // pool queues the email with no copies, so the send after the commit
      // goes to the visitor alone.
      await withTimeout(
        (async () => {
          while (sent.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        })(),
        POOL_WAIT_MS * 3
      );
      expect(sent[0]?.cc).toEqual([COPY]);
    }, 30_000);
  }
);
