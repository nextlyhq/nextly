/**
 * @module cli/commands/upgrade.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../__tests__/fixtures/db";

import { runReconcileCore } from "./upgrade";

describe("runReconcileCore", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("runs reconcileCore in dev-loose with the supplied confirm callback", async () => {
    const reconcile = vi.fn().mockResolvedValue({ changed: false });
    const confirm = vi.fn().mockResolvedValue(true);

    await runReconcileCore(
      {
        adapter: {
          tableExists: () => Promise.resolve(false),
          getDrizzle: () => testDb.db,
          dropTable: () => Promise.resolve(),
          getCapabilities: () => ({ dialect: "sqlite" }),
        },
        confirmDestructive: confirm,
      },
      { reconcileCore: reconcile }
    );

    expect(reconcile).toHaveBeenCalledOnce();
    const passed = reconcile.mock.calls[0][0] as {
      mode: string;
      confirmDestructive: unknown;
    };
    expect(passed.mode).toBe("dev-loose");
    expect(passed.confirmDestructive).toBe(confirm);
  });

  it("refuses when legacy bookkeeping is still present", async () => {
    const reconcile = vi.fn();
    await expect(
      runReconcileCore(
        {
          adapter: {
            tableExists: (t: string) =>
              Promise.resolve(t === "nextly_migrations"),
            getDrizzle: () => testDb.db,
            dropTable: () => Promise.resolve(),
            getCapabilities: () => ({ dialect: "sqlite" }),
          },
          confirmDestructive: () => Promise.resolve(true),
        },
        { reconcileCore: reconcile }
      )
    ).rejects.toMatchObject({ code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED" });
    expect(reconcile).not.toHaveBeenCalled();
  });
});
