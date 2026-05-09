// Regression: init.ts builds the drift-check input from `config.collections`
// and must forward each collection's `status` flag. Without this, drift
// detection sees no status column on the desired side and silently misses
// the case where `defineCollection({ status: true })` was added to a config
// whose live DB table lacks the system status column.
//
// We test runDriftCheck with a synthetic collection input that already has
// status forwarded — pinning the contract that the input shape carries
// status all the way to previewDesiredSchema. The init.ts caller is
// re-verified end-to-end by the yalc smoke test.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { runDriftCheck } from "../drift-check";

interface FakeAdapter {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

const fakeLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeAdapter(): FakeAdapter {
  return { dialect: "sqlite", getDrizzle: () => ({}) };
}

describe("runDriftCheck — status flag propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes collection.status through to previewDesiredSchema as desired.collections.<slug>.status", async () => {
    const previewDesiredSchema = vi.fn().mockResolvedValue({
      operations: [],
      events: [],
      candidates: [],
      classification: "safe",
      liveSnapshot: { tables: [] },
    });

    await runDriftCheck({
      adapter: makeAdapter() as unknown as Parameters<
        typeof runDriftCheck
      >[0]["adapter"],
      collections: [
        {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "description", type: "text", required: true }],
          // The bug was that init.ts dropped this field entirely; here we
          // assert that runDriftCheck preserves whatever the caller passed.
          status: true,
        } as unknown as Parameters<typeof runDriftCheck>[0]["collections"][0],
      ],
      logger: fakeLogger,
      deps: { previewDesiredSchema },
    });

    expect(previewDesiredSchema).toHaveBeenCalledTimes(1);
    const arg = previewDesiredSchema.mock.calls[0][0];
    expect(arg.desired.collections.posts.status).toBe(true);
  });

  it("preserves status: false (or unset) so non-status collections aren't forced on", async () => {
    const previewDesiredSchema = vi.fn().mockResolvedValue({
      operations: [],
      events: [],
      candidates: [],
      classification: "safe",
      liveSnapshot: { tables: [] },
    });

    await runDriftCheck({
      adapter: makeAdapter() as unknown as Parameters<
        typeof runDriftCheck
      >[0]["adapter"],
      collections: [
        {
          slug: "categories",
          tableName: "dc_categories",
          fields: [{ name: "name", type: "text", required: true }],
        } as unknown as Parameters<typeof runDriftCheck>[0]["collections"][0],
      ],
      logger: fakeLogger,
      deps: { previewDesiredSchema },
    });

    const arg = previewDesiredSchema.mock.calls[0][0];
    expect(arg.desired.collections.categories.status).toBeUndefined();
  });
});
