import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

function deps(over: Record<string, unknown> = {}) {
  return {
    dialect: "postgresql" as const,
    db: {},
    adapter: {} as never,
    migrationsDir: "/tmp/migrations",
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast" as const,
    reconcileCoreFn: vi.fn(async () => ({ changed: false })),
    runFileMigrationsFn: vi.fn(async () => 0),
    migrateFieldGroupStorageFn: vi.fn(async () => ({
      ran: false as const,
      reason: "already-migrated" as const,
    })),
    // pass-through lock that just runs fn (so we test the core, not the lock)
    withLock: async (_db: unknown, _d: unknown, fn: () => Promise<unknown>) =>
      fn(),
    ...over,
  };
}

describe("migrateCore", () => {
  it("runs reconcile + file migrations, returns a result, never process.exit", async () => {
    const d = deps();
    const res = await migrateCore(d as never);
    expect(d.reconcileCoreFn).toHaveBeenCalledOnce();
    expect(d.migrateFieldGroupStorageFn).toHaveBeenCalledOnce();
    expect(d.runFileMigrationsFn).toHaveBeenCalledOnce();
    expect(res).toMatchObject({
      applied: 0,
      coreChanged: false,
      storageMigrated: false,
    });
  });

  // 🔴 The storage phase sits between the two, and both sides matter. It needs
  // the core tables the reconcile creates - its marker lives in `nextly_meta` -
  // and it has to precede the user's files, because a committed migration may
  // name a field-group table and this phase changes those names.
  it("migrates storage after the core reconcile and before the user's files", async () => {
    const order: string[] = [];
    const d = deps({
      reconcileCoreFn: vi.fn(async () => {
        order.push("reconcile");
        return { changed: false };
      }),
      migrateFieldGroupStorageFn: vi.fn(async () => {
        order.push("storage");
        return { ran: true as const, direction: "up" as const, steps: 3 };
      }),
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 0;
      }),
    });

    const res = await migrateCore(d as never);
    expect(order).toEqual(["reconcile", "storage", "files"]);
    expect(res).toMatchObject({ storageMigrated: true });
  });

  // A storage migration that refuses must stop the run rather than letting the
  // user's files apply against half-renamed storage.
  it("THROWS when the storage migration refuses, before any file is applied", async () => {
    const d = deps({
      migrateFieldGroupStorageFn: vi.fn(async () => {
        throw new Error("storage refused");
      }),
    });
    await expect(migrateCore(d as never)).rejects.toThrow(/storage refused/);
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
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
