// Unit tests for ensureFirstRunSetup — F8 PR 6.
//
// Probes for `nextly_schema_events` (Nextly-namespaced — avoids
// false negatives on shared DBs that already have a `users` table from
// another framework). When missing, calls freshPushSchema for the
// dialect's static system tables. Failure-safe: never throws.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { ensureFirstRunSetup } from "../first-run";

interface FakeAdapter {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
  tableExists: (name: string) => Promise<boolean>;
  executeQuery: (sql: string) => Promise<unknown>;
}

function makeAdapter(opts: {
  dialect?: "postgresql" | "mysql" | "sqlite";
  journalExists?: boolean;
  probeThrows?: boolean;
}): FakeAdapter {
  return {
    dialect: opts.dialect ?? "sqlite",
    getDrizzle: () => ({}),
    executeQuery: vi.fn(async () => undefined),
    tableExists: vi.fn(async (name: string) => {
      if (opts.probeThrows) throw new Error("connection lost");
      if (name === "nextly_schema_events") {
        return opts.journalExists ?? false;
      }
      return false;
    }),
  };
}

const fakeLedgerDdl = ["CREATE TABLE nextly_schema_events (...)"];

const fakeLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fakeStaticTables = { users: {}, roles: {} };

describe("ensureFirstRunSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls freshPushSchema and logs setup banner when journal is missing", async () => {
    const adapter = makeAdapter({ journalExists: false });
    const freshPushSchema = vi.fn().mockResolvedValue({
      statementsExecuted: ["CREATE TABLE users", "CREATE TABLE roles"],
      applied: true,
    });

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema,
        getDialectTables: () => fakeStaticTables,
      },
    });

    expect(result.ranSetup).toBe(true);
    if (result.ranSetup) {
      expect(result.statementsExecuted).toBe(2);
    }
    expect(freshPushSchema).toHaveBeenCalledOnce();
    const setupCalls = fakeLogger.info.mock.calls
      .map(args => args[0] as string)
      .filter(line => line.includes("Setting up database schema"));
    expect(setupCalls.length).toBe(1);
    const doneCalls = fakeLogger.info.mock.calls
      .map(args => args[0] as string)
      .filter(line => /done in \d+ms/i.test(line));
    expect(doneCalls.length).toBe(1);
  });

  it("returns 'already_initialized' without calling freshPushSchema when journal exists", async () => {
    const adapter = makeAdapter({ journalExists: true });
    const freshPushSchema = vi.fn();

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema,
        getDialectTables: () => fakeStaticTables,
      },
    });

    expect(result).toEqual({
      ranSetup: false,
      reason: "already_initialized",
    });
    expect(freshPushSchema).not.toHaveBeenCalled();
    expect(fakeLogger.info).not.toHaveBeenCalled();
  });

  it("returns 'probe_failed' and logs warn when tableExists throws", async () => {
    const adapter = makeAdapter({ probeThrows: true });
    const freshPushSchema = vi.fn();

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema,
        getDialectTables: () => fakeStaticTables,
      },
    });

    expect(result).toEqual({ ranSetup: false, reason: "probe_failed" });
    expect(freshPushSchema).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledOnce();
  });

  it("logs error and returns 'probe_failed' when freshPushSchema throws", async () => {
    const adapter = makeAdapter({ journalExists: false });
    const freshPushSchema = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema,
        getDialectTables: () => fakeStaticTables,
      },
    });

    expect(result.ranSetup).toBe(false);
    if (!result.ranSetup) {
      expect(result.reason).toBe("probe_failed");
    }
    expect(fakeLogger.error).toHaveBeenCalled();
    const errorCalls = fakeLogger.error.mock.calls
      .map(args => args[0] as string)
      .filter(line => /db:sync/i.test(line));
    expect(errorCalls.length).toBe(1);
  });

  it("uses the nextly_schema_events probe (not a generic users table)", async () => {
    const adapter = makeAdapter({ journalExists: false });

    await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema: vi.fn().mockResolvedValue({
          statementsExecuted: [],
          applied: true,
        }),
        getDialectTables: () => fakeStaticTables,
      },
    });

    const probeCalls = (
      adapter.tableExists as unknown as { mock: { calls: string[][] } }
    ).mock.calls;
    // Probes the Nextly-namespaced ledger (not a generic `users` table). The
    // post-push bootstrap guard probes the same table again, so don't pin the
    // exact count — pin that every probe targets nextly_schema_events.
    expect(probeCalls.length).toBeGreaterThanOrEqual(1);
    expect(probeCalls.every(c => c[0] === "nextly_schema_events")).toBe(true);
  });

  it("bootstraps the nextly_schema_events ledger via executeQuery when missing", async () => {
    const adapter = makeAdapter({ journalExists: false });

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema: vi
          .fn()
          .mockResolvedValue({ statementsExecuted: [], applied: true }),
        getDialectTables: () => fakeStaticTables,
        getSchemaEventsDdl: () => fakeLedgerDdl,
      },
    });

    expect(result.ranSetup).toBe(true);
    // The ledger DDL must be executed out-of-band so the journal/builder
    // endpoints don't fail with "relation nextly_schema_events does not exist".
    expect(adapter.executeQuery).toHaveBeenCalledWith(fakeLedgerDdl[0]);
  });

  it("skips the out-of-band ledger bootstrap when freshPushSchema already created it", async () => {
    // Regression for the MySQL duplicate-index abort: the ledger is now in
    // getDialectTables, so freshPushSchema creates it (+ its indexes). Re-running
    // getSchemaEventsDdl would then `CREATE INDEX` again — and MySQL's raw DDL has
    // no IF NOT EXISTS, so it throws. The bootstrap must be skipped once the ledger
    // exists. Stateful probe: missing at the top (setup runs), present afterwards.
    let probeCount = 0;
    const adapter: FakeAdapter = {
      dialect: "mysql",
      getDrizzle: () => ({}),
      executeQuery: vi.fn(async () => undefined),
      tableExists: vi.fn(async (name: string) => {
        if (name !== "nextly_schema_events") return false;
        probeCount += 1;
        return probeCount > 1; // false on the top probe, true after freshPushSchema
      }),
    };

    const result = await ensureFirstRunSetup({
      adapter,
      logger: fakeLogger,
      deps: {
        freshPushSchema: vi
          .fn()
          .mockResolvedValue({ statementsExecuted: [], applied: true }),
        getDialectTables: () => fakeStaticTables,
        getSchemaEventsDdl: () => fakeLedgerDdl,
      },
    });

    expect(result.ranSetup).toBe(true);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });
});
