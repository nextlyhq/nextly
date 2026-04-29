// Unit tests for runDriftCheck — F8 PR 6.
//
// Three cases:
//   - First run: empty DB → log + create static tables
//   - Drift:     non-zero diff against config → one-line warning,
//                 no auto-apply (HMR/db:sync owns that)
//   - Clean:     non-empty DB + zero drift → log nothing
//
// Mocks the adapter, freshPushSchema, and previewDesiredSchema so the
// tests stay focused on the decision logic + log-line copy.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { runDriftCheck } from "../drift-check.js";

interface FakeAdapter {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
  tableExists: (name: string) => Promise<boolean>;
  getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
}

function makeAdapter(opts: {
  dialect?: "postgresql" | "mysql" | "sqlite";
  usersExists?: boolean;
}): FakeAdapter {
  const dialect = opts.dialect ?? "sqlite";
  return {
    dialect,
    getDrizzle: () => ({}),
    tableExists: vi.fn(async (name: string) => {
      if (name === "users") return opts.usersExists ?? false;
      return false;
    }),
    getCapabilities: () => ({ dialect }),
  };
}

const fakeLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("runDriftCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("first run (empty DB)", () => {
    it("logs the setup banner and calls freshPushSchema", async () => {
      const adapter = makeAdapter({ usersExists: false });
      const freshPushSchema = vi.fn().mockResolvedValue({
        statementsExecuted: ["CREATE TABLE users", "CREATE TABLE roles"],
        applied: true,
      });

      const result = await runDriftCheck({
        adapter,
        collections: [],
        logger: fakeLogger,
        deps: {
          freshPushSchema,
          previewDesiredSchema: vi.fn(),
        },
      });

      expect(result.kind).toBe("first_run");
      expect(freshPushSchema).toHaveBeenCalledOnce();
      // Setup banner logged.
      const setupCalls = (
        fakeLogger.info as unknown as { mock: { calls: string[][] } }
      ).mock.calls
        .map(args => args[0])
        .filter(line => line.includes("Setting up database schema"));
      expect(setupCalls.length).toBe(1);
    });

    it("logs success duration after setup completes", async () => {
      const adapter = makeAdapter({ usersExists: false });
      const freshPushSchema = vi.fn().mockResolvedValue({
        statementsExecuted: [],
        applied: true,
      });

      await runDriftCheck({
        adapter,
        collections: [],
        logger: fakeLogger,
        deps: {
          freshPushSchema,
          previewDesiredSchema: vi.fn(),
        },
      });

      const doneCalls = (
        fakeLogger.info as unknown as { mock: { calls: string[][] } }
      ).mock.calls
        .map(args => args[0])
        .filter(line => /done in \d+ms/i.test(line));
      expect(doneCalls.length).toBe(1);
    });

    it("logs an error and returns kind='clean' when freshPushSchema throws", async () => {
      const adapter = makeAdapter({ usersExists: false });
      const freshPushSchema = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      const result = await runDriftCheck({
        adapter,
        collections: [],
        logger: fakeLogger,
        deps: {
          freshPushSchema,
          previewDesiredSchema: vi.fn(),
        },
      });

      // Drift check must not break boot — failure is logged and we
      // bail out with a non-blocking 'clean' verdict so init proceeds.
      expect(result.kind).toBe("clean");
      expect(fakeLogger.error).toHaveBeenCalled();
    });
  });

  describe("drift (non-empty DB, divergent config)", () => {
    it("logs one warning line and does NOT call freshPushSchema", async () => {
      const adapter = makeAdapter({ usersExists: true });
      const previewDesiredSchema = vi.fn().mockResolvedValue({
        operations: [
          { type: "add_column", tableName: "dc_posts", column: { name: "x" } },
          { type: "add_column", tableName: "dc_posts", column: { name: "y" } },
        ],
        events: [],
        candidates: [],
        classification: "safe",
        liveSnapshot: { tables: [] },
      });
      const freshPushSchema = vi.fn();

      const result = await runDriftCheck({
        adapter,
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [],
          },
        ],
        logger: fakeLogger,
        deps: {
          freshPushSchema,
          previewDesiredSchema,
        },
      });

      expect(result.kind).toBe("drift");
      expect((result as { pending: number }).pending).toBe(2);
      expect(freshPushSchema).not.toHaveBeenCalled();

      const warnCalls = (
        fakeLogger.warn as unknown as { mock: { calls: string[][] } }
      ).mock.calls
        .map(args => args[0])
        .filter(line => /schema drift/i.test(line));
      expect(warnCalls.length).toBe(1);
    });

    it("aggregates operations across multiple collections in one warning", async () => {
      const adapter = makeAdapter({ usersExists: true });
      let callIndex = 0;
      const previewDesiredSchema = vi.fn().mockImplementation(() => {
        callIndex += 1;
        return Promise.resolve({
          operations: [
            { type: "add_column", tableName: "dc_a", column: { name: "x" } },
          ],
          events: [],
          candidates: [],
          classification: "safe",
          liveSnapshot: { tables: [] },
        });
      });

      const result = await runDriftCheck({
        adapter,
        collections: [
          { slug: "a", tableName: "dc_a", fields: [] },
          { slug: "b", tableName: "dc_b", fields: [] },
        ],
        logger: fakeLogger,
        deps: {
          freshPushSchema: vi.fn(),
          previewDesiredSchema,
        },
      });

      expect(result.kind).toBe("drift");
      expect((result as { pending: number }).pending).toBe(2);
      expect(callIndex).toBe(2);
    });

    it("logs nothing when previewDesiredSchema throws (best-effort)", async () => {
      const adapter = makeAdapter({ usersExists: true });
      const previewDesiredSchema = vi
        .fn()
        .mockRejectedValue(new Error("introspect failed"));

      const result = await runDriftCheck({
        adapter,
        collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
        logger: fakeLogger,
        deps: {
          freshPushSchema: vi.fn(),
          previewDesiredSchema,
        },
      });

      // Failure to compute drift is non-fatal — we return clean and
      // the pipeline's HMR / db:sync paths will surface real issues.
      expect(result.kind).toBe("clean");
      const warnCalls = (
        fakeLogger.warn as unknown as { mock: { calls: string[][] } }
      ).mock.calls
        .map(args => args[0])
        .filter(line => /schema drift/i.test(line));
      expect(warnCalls.length).toBe(0);
    });
  });

  describe("clean (non-empty DB, no drift)", () => {
    it("logs nothing and returns kind='clean'", async () => {
      const adapter = makeAdapter({ usersExists: true });
      const previewDesiredSchema = vi.fn().mockResolvedValue({
        operations: [],
        events: [],
        candidates: [],
        classification: "safe",
        liveSnapshot: { tables: [] },
      });

      const result = await runDriftCheck({
        adapter,
        collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
        logger: fakeLogger,
        deps: {
          freshPushSchema: vi.fn(),
          previewDesiredSchema,
        },
      });

      expect(result.kind).toBe("clean");
      expect(fakeLogger.info).not.toHaveBeenCalled();
      expect(fakeLogger.warn).not.toHaveBeenCalled();
    });

    it("returns kind='clean' when there are no collections (empty config)", async () => {
      const adapter = makeAdapter({ usersExists: true });
      const previewDesiredSchema = vi.fn();

      const result = await runDriftCheck({
        adapter,
        collections: [],
        logger: fakeLogger,
        deps: {
          freshPushSchema: vi.fn(),
          previewDesiredSchema,
        },
      });

      expect(result.kind).toBe("clean");
      // No collections to preview = no preview calls.
      expect(previewDesiredSchema).not.toHaveBeenCalled();
    });
  });
});
