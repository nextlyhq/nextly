/**
 * Regression: SqliteAdapter.transaction() must serialize concurrent calls.
 *
 * better-sqlite3 is single-connection and synchronous. Two `await
 * adapter.transaction(...)` calls that overlap on the JS event loop both
 * try to issue `BEGIN IMMEDIATE` on the same connection; the second
 * throws `cannot start a transaction within a transaction`. That used
 * to break bulk-update flows in the admin (e.g. bulk Publish/Unpublish
 * across N entries) where a `Promise.allSettled` over per-row updates
 * fans out N concurrent `transaction()` calls.
 *
 * Fix: the adapter chains every `transaction()` invocation onto an
 * internal queue. Only one BEGIN/COMMIT pair runs at a time, and each
 * subsequent call waits for the previous one to finish. This pins the
 * contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteAdapter } from "../index";

const mockExec = vi.fn();
const mockPrepare = vi.fn();
const mockPragma = vi.fn();
const mockClose = vi.fn();

const mockStatement = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

class MockDatabase {
  prepare = mockPrepare;
  exec = mockExec;
  pragma = mockPragma;
  close = mockClose;
  inTransaction = false;
  constructor(_path: string, _options?: Record<string, unknown>) {}
}

vi.mock("better-sqlite3", () => ({ default: MockDatabase }));

describe("SqliteAdapter — transaction() serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.toLowerCase().includes("sqlite_version()")
      ) {
        return {
          run: vi.fn(),
          all: vi.fn().mockReturnValue([]),
          get: vi.fn().mockReturnValue({ version: "3.45.0" }),
        };
      }
      return mockStatement;
    });
    mockStatement.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
    mockStatement.all.mockReturnValue([]);
    mockStatement.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeAdapter(): Promise<SqliteAdapter> {
    const adapter = new SqliteAdapter({ filename: ":memory:" });
    await adapter.connect();
    return adapter;
  }

  it("serializes overlapping transaction() calls (no BEGIN-within-BEGIN)", async () => {
    const adapter = await makeAdapter();

    // Why: the queue must guarantee that BEGIN N+1 only runs after
    // COMMIT/ROLLBACK N. We assert the exact sequence below by
    // observing the order in which db.exec("BEGIN IMMEDIATE") and
    // db.exec("COMMIT") are called across three concurrent
    // transactions.
    const observed: string[] = [];
    mockExec.mockImplementation((sql: string) => {
      observed.push(sql);
    });

    // Each work() resolves after a microtask so the promises overlap
    // but cannot tail-call into each other on the same tick.
    const work = (label: string) => async () => {
      observed.push(`work:${label}`);
      // Force a real await so the JS scheduler interleaves.
      await Promise.resolve();
      return label;
    };

    const results = await Promise.all([
      adapter.transaction(work("a")),
      adapter.transaction(work("b")),
      adapter.transaction(work("c")),
    ]);

    expect(results).toEqual(["a", "b", "c"]);

    // Filter to just the BEGIN/COMMIT/work events for clarity.
    const flow = observed.filter(
      e =>
        e === "BEGIN IMMEDIATE" ||
        e === "COMMIT" ||
        e === "ROLLBACK" ||
        e.startsWith("work:")
    );

    // Expected interleaving for three serialized transactions:
    //   BEGIN -> work:a -> COMMIT -> BEGIN -> work:b -> COMMIT -> BEGIN -> work:c -> COMMIT
    expect(flow).toEqual([
      "BEGIN IMMEDIATE",
      "work:a",
      "COMMIT",
      "BEGIN IMMEDIATE",
      "work:b",
      "COMMIT",
      "BEGIN IMMEDIATE",
      "work:c",
      "COMMIT",
    ]);
  });

  it("a thrown work() rolls back without poisoning the queue for subsequent transactions", async () => {
    const adapter = await makeAdapter();

    const observed: string[] = [];
    mockExec.mockImplementation((sql: string) => {
      observed.push(sql);
    });

    // Caller A throws — its transaction should ROLLBACK.
    // Caller B fires concurrently and must still get a clean BEGIN/COMMIT
    // afterward. (Without the `.catch(() => undefined)` on the queue
    // tail, B's `then(run, run)` would re-run on rejection but the
    // chained tail would stay rejected and break later transactions.)
    const a = adapter
      .transaction(async () => {
        observed.push("work:a");
        throw new Error("boom");
      })
      .catch(err => `a-rejected:${(err as Error).message}`);

    const b = adapter.transaction(async () => {
      observed.push("work:b");
      return "b-ok";
    });

    const c = adapter.transaction(async () => {
      observed.push("work:c");
      return "c-ok";
    });

    expect(await a).toBe("a-rejected:boom");
    expect(await b).toBe("b-ok");
    expect(await c).toBe("c-ok");

    const flow = observed.filter(
      e =>
        e === "BEGIN IMMEDIATE" ||
        e === "COMMIT" ||
        e === "ROLLBACK" ||
        e.startsWith("work:")
    );
    expect(flow).toEqual([
      "BEGIN IMMEDIATE",
      "work:a",
      "ROLLBACK",
      "BEGIN IMMEDIATE",
      "work:b",
      "COMMIT",
      "BEGIN IMMEDIATE",
      "work:c",
      "COMMIT",
    ]);
  });
});
