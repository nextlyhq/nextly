/**
 * @module cli/commands/upgrade.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../__tests__/fixtures/db";

import { CliError } from "../errors";
import { previewReconcileCore, runReconcileCore } from "./upgrade";

// The schema lock is exercised against real databases in its own suites. These drive the upgrade steps
// through a narrow adapter double that cannot hold it, so here the lock runs the work as given.
// `program` imports every command, `migrate` with its whole graph among them;
// the command under test takes only its context factory from it, and is
// handed its context here.
vi.mock("../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../domains/schema/pipeline/locks", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../domains/schema/pipeline/locks")
  >()),
  withMigrateLock: async <T>(
    _adapter: unknown,
    _dialect: unknown,
    fn: () => Promise<T>
  ) => ({ ran: true as const, value: await fn() }),
}));

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
        checkAppHistory: () => Promise.resolve(),
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
          checkAppHistory: () => Promise.resolve(),
        },
        { reconcileCore: reconcile }
      )
    ).rejects.toMatchObject({ code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("reports, in a dry run, the history refusal a real run stops on, and plans nothing past it", async () => {
    const missing = new CliError("MIGRATION_MISSING", {
      what: "The ledger records 1 applied migration this build's migrations folder lacks.",
      why: "A newer build has migrated this database.",
      next: "Deploy the build that holds the file.",
    });
    const plan = await previewReconcileCore({
      adapter: {
        tableExists: () => Promise.resolve(false),
        getDrizzle: () => testDb.db,
        dropTable: () => Promise.resolve(),
        getCapabilities: () => ({ dialect: "sqlite" }),
      },
      interactive: false,
      checkAppHistory: () => Promise.reject(missing),
    });
    expect(plan).toEqual({ changes: [], refusals: [missing.publicMessage] });
  });

  it("runs the app history checks before the core reconcile, which a refusal leaves unrun", async () => {
    const reconcile = vi.fn();
    const refusal = new Error("an applied migration the folder lacks");
    await expect(
      runReconcileCore(
        {
          adapter: {
            tableExists: () => Promise.resolve(false),
            getDrizzle: () => testDb.db,
            dropTable: () => Promise.resolve(),
            getCapabilities: () => ({ dialect: "sqlite" }),
          },
          confirmDestructive: () => Promise.resolve(true),
          checkAppHistory: () => Promise.reject(refusal),
        },
        { reconcileCore: reconcile }
      )
    ).rejects.toBe(refusal);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
