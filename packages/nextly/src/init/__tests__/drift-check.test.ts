// Unit tests for runDriftCheck — F8 PR 6 (refactored after review).
//
// Two cases: drift / clean. First-run setup moved to ensureFirstRunSetup
// (see first-run.test.ts) per review #2 — first-run must run BEFORE
// registerServices' dynamic-table probing, not after.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { runDriftCheck } from "../drift-check";

interface FakeAdapter {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

function makeAdapter(
  dialect: "postgresql" | "mysql" | "sqlite" = "sqlite"
): FakeAdapter {
  return {
    dialect,
    getDrizzle: () => ({}),
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

  describe("drift (live DB diverges from config)", () => {
    it("logs one warning line and returns kind='drift'", async () => {
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

      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(result.kind).toBe("drift");
      expect((result as { pending: number }).pending).toBe(2);
      const warnCalls = fakeLogger.warn.mock.calls
        .map(args => args[0] as string)
        .filter(line => /schema drift/i.test(line));
      expect(warnCalls.length).toBe(1);
    });

    it("aggregates operations across multiple collections", async () => {
      const previewDesiredSchema = vi.fn().mockResolvedValue({
        operations: [
          { type: "add_column", tableName: "dc_x", column: { name: "x" } },
        ],
        events: [],
        candidates: [],
        classification: "safe",
        liveSnapshot: { tables: [] },
      });

      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [
          { slug: "a", tableName: "dc_a", fields: [] },
          { slug: "b", tableName: "dc_b", fields: [] },
        ],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(result.kind).toBe("drift");
      expect((result as { pending: number }).pending).toBe(2);
      expect(previewDesiredSchema).toHaveBeenCalledTimes(2);
    });

    it("runs previews in parallel (review #4)", async () => {
      let active = 0;
      let maxConcurrent = 0;
      const previewDesiredSchema = vi.fn().mockImplementation(async () => {
        active += 1;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise(r => setTimeout(r, 10));
        active -= 1;
        return {
          operations: [],
          events: [],
          candidates: [],
          classification: "safe",
          liveSnapshot: { tables: [] },
        };
      });

      await runDriftCheck({
        adapter: makeAdapter(),
        collections: [
          { slug: "a", tableName: "dc_a", fields: [] },
          { slug: "b", tableName: "dc_b", fields: [] },
          { slug: "c", tableName: "dc_c", fields: [] },
        ],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(maxConcurrent).toBeGreaterThan(1);
    });
  });

  describe("clean (live DB matches config)", () => {
    it("logs nothing and returns kind='clean'", async () => {
      const previewDesiredSchema = vi.fn().mockResolvedValue({
        operations: [],
        events: [],
        candidates: [],
        classification: "safe",
        liveSnapshot: { tables: [] },
      });

      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(result.kind).toBe("clean");
      expect(fakeLogger.info).not.toHaveBeenCalled();
      expect(fakeLogger.warn).not.toHaveBeenCalled();
    });

    it("returns kind='clean' for empty collections (no previews issued)", async () => {
      const previewDesiredSchema = vi.fn();
      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(result.kind).toBe("clean");
      expect(previewDesiredSchema).not.toHaveBeenCalled();
    });
  });

  describe("failure handling", () => {
    it("logs aggregate failure count when previews fail (review #5)", async () => {
      const previewDesiredSchema = vi
        .fn()
        .mockRejectedValue(new Error("introspect failed"));

      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [
          { slug: "a", tableName: "dc_a", fields: [] },
          { slug: "b", tableName: "dc_b", fields: [] },
        ],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      // All previews failed → no drift detected, but a summary warning fires.
      expect(result.kind).toBe("clean");
      const summaryWarn = fakeLogger.warn.mock.calls
        .map(args => args[0] as string)
        .filter(line => /drift previews failed/i.test(line));
      expect(summaryWarn.length).toBe(1);
      // No "schema drift" warning because no drift was actually detected.
      const driftWarn = fakeLogger.warn.mock.calls
        .map(args => args[0] as string)
        .filter(line => /detected schema drift/i.test(line));
      expect(driftWarn.length).toBe(0);
    });

    it("partial success: counts the successful drift", async () => {
      let callIndex = 0;
      const previewDesiredSchema = vi.fn().mockImplementation(() => {
        callIndex += 1;
        if (callIndex === 1) {
          return Promise.resolve({
            operations: [
              {
                type: "add_column",
                tableName: "dc_a",
                column: { name: "x" },
              },
            ],
            events: [],
            candidates: [],
            classification: "safe",
            liveSnapshot: { tables: [] },
          });
        }
        return Promise.reject(new Error("introspect failed"));
      });

      const result = await runDriftCheck({
        adapter: makeAdapter(),
        collections: [
          { slug: "a", tableName: "dc_a", fields: [] },
          { slug: "b", tableName: "dc_b", fields: [] },
        ],
        logger: fakeLogger,
        deps: { previewDesiredSchema },
      });

      expect(result.kind).toBe("drift");
      expect((result as { pending: number }).pending).toBe(1);
    });
  });
});
