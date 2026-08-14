import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

function deps(over: Record<string, unknown> = {}) {
  return {
    dialect: "postgresql" as const,
    // Answers the catalog probe the way a database with no field-group
    // registry does. Inert would let the resolution throw, and this orchestration
    // suite would then be asserting on an error from a collaborator rather than
    // on what `migrateCore` does with its steps.
    db: { execute: async () => ({ rows: [] }) },
    adapter: {} as never,
    migrationsDir: "/tmp/migrations",
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast" as const,
    reconcileCoreFn: vi.fn(async () => ({ changed: false })),
    runFileMigrationsFn: vi.fn(async () => 0),
    // Pass-through lock that just runs fn (so we test the core, not the lock),
    // in the real shape: the outcome is discriminated so a caller cannot
    // confuse "returned undefined" with "never ran".
    withLock: async (
      _db: unknown,
      _d: unknown,
      fn: () => Promise<unknown>
    ) => ({
      ran: true as const,
      value: await fn(),
    }),
    ...over,
  };
}

describe("migrateCore", () => {
  it("runs reconcile + file migrations, returns a result, never process.exit", async () => {
    const d = deps();
    const res = await migrateCore(d as never);
    expect(d.reconcileCoreFn).toHaveBeenCalledOnce();
    expect(d.runFileMigrationsFn).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ applied: 0, coreChanged: false });
  });

  it("THROWS (does not exit) when file migrations reject", async () => {
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        throw new Error("apply failed");
      }),
    });
    await expect(migrateCore(d as never)).rejects.toThrow(/apply failed/);
  });
});
