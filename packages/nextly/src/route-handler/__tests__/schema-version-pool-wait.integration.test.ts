/**
 * A request is not held behind the routine read of the stored schema version
 * while that read waits for a pooled connection, on every dialect.
 *
 * Every admin request, and every Direct API call, asks for the schema version
 * this copy serves (`servedSchemaVersion`) before it is served. The read is
 * one row, but it needs a connection, and where every connection in the pool
 * is held the read waits the pool's whole acquire bound, with each request
 * waiting on it. Its failure already serves what this copy has, so the wait
 * bought nothing, and it said nothing: on a small serverless pool admin
 * requests stalled together for the bound, again and again, while the
 * database showed only idle connections.
 *
 * Each dialect's adapter is built with a one-connection pool and an acquire
 * bound well past the request's, and one transaction holds that connection
 * open, which is the separating condition: with a free connection the read
 * never waits, and a request held for the read looks exactly like one that
 * is not. Each case asserts that:
 *
 * - the request was answered once its own bound passed, and well before the
 *   pool's;
 * - the read behind it reached the pool and waited out its bound there (the
 *   adapter's pool-wait warning), and its failure was logged with its code;
 * - once the connection is free the version is read again at once.
 *
 * On SQLite there is no pool: the read runs on the one connection at once,
 * so the request is answered at once and nothing waits; the case holds that
 * no dialect waits longer than the bound.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { makeTestContext } from "../../database/__tests__/integration/helpers/test-db";
import { createAdapter } from "../../database/factory";
import { container } from "../../di/container";

// The definitions' reload is not what is measured: a read that finds a
// version reloads nothing real here, so the case times the read alone.
vi.mock("../../init/reload-dynamic-tables", () => ({
  reloadDynamicTables: () => Promise.resolve(true),
}));
// Services count as started once the adapter is in the container, as a
// started copy's are.
vi.mock("../../di/service-access", async importOriginal => ({
  ...(await importOriginal<typeof import("../../di/service-access")>()),
  isServicesRegistered: () => true,
}));

import {
  bumpSchemaVersion,
  SCHEMA_VERSION_WAIT_MS,
  servedSchemaVersion,
} from "../schema-version";

/** The pool's acquire bound: well past the request's, so the two are told apart. */
const POOL_BOUND_MS = SCHEMA_VERSION_WAIT_MS * 3;

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** The lines `console.warn` was given that contain `text`. */
function warned(spy: { mock: { calls: unknown[][] } }, text: string): string[] {
  return spy.mock.calls
    .map(call => String(call[0]))
    .filter(line => line.includes(text));
}

for (const dialect of DIALECTS) {
  const context = makeTestContext(dialect);

  describe.skipIf(!context.available)(
    `a request while the pool is held, on ${dialect}`,
    () => {
      let adapter: DrizzleAdapter;

      beforeAll(async () => {
        adapter = (await createAdapter({
          type: dialect,
          url: context.url ?? undefined,
          pool: { max: 1, connectionTimeoutMs: POOL_BOUND_MS },
        })) as DrizzleAdapter;
      });

      afterAll(async () => {
        await adapter?.disconnect();
      });

      beforeEach(() => {
        // A process that has served nothing yet, on this adapter.
        delete (globalThis as { __nextly_servedSchema?: unknown })
          .__nextly_servedSchema;
        container.registerSingleton("adapter", () => adapter);
      });

      afterEach(() => {
        container.clear();
        vi.restoreAllMocks();
      });

      /** A transaction holding the pool's one connection until released. */
      async function holdTheConnection(): Promise<{
        release: () => void;
        done: Promise<unknown>;
      }> {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        // Released anyway once the pool's bound is long over, so a request
        // that is held fails its own case by name rather than the suite.
        const safety = setTimeout(() => release(), POOL_BOUND_MS + 5000);
        void gate.then(() => clearTimeout(safety));
        let opened!: () => void;
        const isOpen = new Promise<void>(resolve => (opened = resolve));
        const done = adapter.transaction(async () => {
          opened();
          await gate;
        });
        await isOpen;
        return { release, done };
      }

      it("is answered within its own bound, and the read behind it waits out the pool's and says so", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const holder = await holdTheConnection();

        const started = Date.now();
        const served = await servedSchemaVersion();
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(POOL_BOUND_MS - SCHEMA_VERSION_WAIT_MS);

        if (dialect !== "sqlite") {
          // Nothing was read yet in this process: the request goes on with
          // what the start loaded, as a failed read would have it.
          expect(served).toBeUndefined();
          // The bound decided it, not a read that happened to be quick.
          expect(elapsed).toBeGreaterThanOrEqual(SCHEMA_VERSION_WAIT_MS - 50);
          expect(warned(warn, "has not answered in")).toHaveLength(1);
          // The read behind it reached the pool, waited out its bound, and
          // its failure is in the log with the pool-wait code.
          await vi.waitFor(
            () =>
              expect(
                warned(warn, "Could not read the stored schema version")
              ).toHaveLength(1),
            { timeout: POOL_BOUND_MS + 2000, interval: 100 }
          );
          expect(
            warned(warn, `waited ${POOL_BOUND_MS} ms for a database connection`)
          ).toHaveLength(1);
          expect(
            warned(warn, "Could not read the stored schema version")[0]
          ).toContain("(NEXTLY_POOL_WAIT_TIMEOUT)");
        }

        holder.release();
        await holder.done;

        // With the connection free, a read asked for now is quick again.
        bumpSchemaVersion();
        const again = Date.now();
        await servedSchemaVersion();
        expect(Date.now() - again).toBeLessThan(SCHEMA_VERSION_WAIT_MS);
      });
    }
  );
}
