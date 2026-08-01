/**
 * A refusal raised inside a transaction reaches the caller as itself.
 *
 * Application code throws inside `transaction()` to roll a write back — a
 * refused value, a denied permission. That error is the application's verdict,
 * not the driver's failure, and it used to be replaced on the way out by the
 * adapter's error classification: the caller received a generic database error
 * and every payload the verdict carried, such as the per-field issues an admin
 * form needs, was gone.
 *
 * The rollback still has to happen — the point is only that what surfaces is
 * what was thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteAdapter } from "../index";

const mockExec = vi.fn();
const mockPrepare = vi.fn();
const mockPragma = vi.fn();
const mockClose = vi.fn();

const mockStatement = { run: vi.fn(), get: vi.fn(), all: vi.fn() };

class MockDatabase {
  prepare = mockPrepare;
  exec = mockExec;
  pragma = mockPragma;
  close = mockClose;
  inTransaction = false;
  constructor(_path: string, _options?: Record<string, unknown>) {}
}

vi.mock("better-sqlite3", () => ({ default: MockDatabase }));

/** An error branded the way the application's own error class brands one. */
function refusal(): Error & { code?: string; publicData?: unknown } {
  const error: Error & { code?: string; publicData?: unknown } = new Error(
    "Validation failed."
  );
  error.code = "VALIDATION_ERROR";
  error.publicData = {
    errors: [
      { path: "badge", code: "REQUIRED", message: "badge is required." },
    ],
  };
  Object.defineProperty(error, Symbol.for("nextly/NextlyError"), {
    value: true,
  });
  return error;
}

describe("SqliteAdapter — a refusal thrown inside transaction()", () => {
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

  it("surfaces the very error that was thrown", async () => {
    const adapter = await makeAdapter();
    const thrown = refusal();

    const caught = await adapter
      .transaction(async () => {
        throw thrown;
      })
      .catch((error: unknown) => error);

    // Identity, not shape: anything that rebuilt it would satisfy a shape
    // check while having decided for itself what to keep.
    expect(caught).toBe(thrown);
  });

  it("keeps the code and the payload a caller reads", async () => {
    const adapter = await makeAdapter();

    const caught: unknown = await adapter
      .transaction(async () => {
        throw refusal();
      })
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: { errors: [{ path: "badge", code: "REQUIRED" }] },
    });
  });

  it("still rolls the transaction back", async () => {
    // Surfacing the verdict must not cost the rollback: the write is being
    // refused, so nothing it did may survive.
    const adapter = await makeAdapter();
    const statements: string[] = [];
    mockExec.mockImplementation((sql: string) => {
      statements.push(sql);
    });

    await adapter
      .transaction(async () => {
        throw refusal();
      })
      .catch(() => undefined);

    expect(statements).toContain("BEGIN IMMEDIATE");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("still classifies an error that did come from the driver", async () => {
    // The other half of the contract. Letting a driver error through unchanged
    // would put raw driver text on the wire in place of a mapped kind.
    const adapter = await makeAdapter();

    const caught: unknown = await adapter
      .transaction(async () => {
        throw new Error("database is locked");
      })
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({ kind: expect.any(String) });
  });
});
