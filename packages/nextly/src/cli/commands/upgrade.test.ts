/**
 * @module cli/commands/upgrade.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../__tests__/fixtures/db";

import { resolveDataLossConsent } from "../../domains/schema/migrate/data-loss-consent";
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

  const adapter = () => ({
    tableExists: () => Promise.resolve(false),
    getDrizzle: () => testDb.db,
    dropTable: () => Promise.resolve(),
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  });
  const ACCESS_RULES = ["dynamic_collections", "dynamic_singles"].map(
    table => ({
      kind: "column" as const,
      table,
      column: "access_rules",
      core: true,
      reason: "stored access rules, no longer enforced since 0.0.2-alpha.66",
    })
  );
  const NAMED = "dynamic_collections.access_rules,dynamic_singles.access_rules";

  it("runs reconcileCore with a judge of what it deletes, the consent agreed before the lock", async () => {
    const reconcile = vi.fn().mockResolvedValue({ changed: false });

    await runReconcileCore(
      {
        adapter: adapter(),
        consent: resolveDataLossConsent({ flag: NAMED }),
        interactive: false,
        checkAppHistory: () => Promise.resolve(),
      },
      {
        reconcileCore: reconcile,
        planCoreDeletions: () => Promise.resolve(ACCESS_RULES),
      }
    );

    expect(reconcile).toHaveBeenCalledOnce();
    const passed = reconcile.mock.calls[0][0] as {
      judgeDeletions: (deletions: readonly unknown[]) => Promise<void>;
    };
    await expect(passed.judgeDeletions(ACCESS_RULES)).resolves.toBeUndefined();
    await expect(
      passed.judgeDeletions([
        { kind: "column", table: "users", column: "name", core: true },
      ])
    ).rejects.toThrow(/users\.name/);
  });

  it("hands what plugins contributed to the core tables to the plan and the reconcile", async () => {
    const reconcile = vi.fn().mockResolvedValue({ changed: false });
    const plan = vi.fn().mockResolvedValue([]);
    const contributions = {
      entityColumns: new Map([["users", []]]),
      entityIndexes: new Map(),
    };

    await runReconcileCore(
      {
        adapter: adapter(),
        consent: resolveDataLossConsent({}),
        interactive: false,
        contributions,
        checkAppHistory: () => Promise.resolve(),
      },
      { reconcileCore: reconcile, planCoreDeletions: plan }
    );

    expect(plan.mock.calls[0][0]).toMatchObject({ contributions });
    expect(reconcile.mock.calls[0][0]).toMatchObject({ contributions });
  });

  it("with no terminal and no consent, refuses before the lock, naming the consent", async () => {
    const reconcile = vi.fn();
    await expect(
      runReconcileCore(
        {
          adapter: adapter(),
          consent: resolveDataLossConsent({}),
          interactive: false,
          checkAppHistory: () => Promise.resolve(),
        },
        {
          reconcileCore: reconcile,
          planCoreDeletions: () => Promise.resolve(ACCESS_RULES),
        }
      )
    ).rejects.toThrow(`--accept-data-loss=${NAMED}`);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("an agreement to one change on a column does not cover another change to it found under the lock", async () => {
    const typeChange = {
      kind: "column" as const,
      table: "users",
      column: "name",
      core: true,
      reason: "type changes from text to varchar",
    };
    const madeRequired = {
      ...typeChange,
      reason: "becomes required, which fails on a row without a value",
    };
    const reconcile = vi.fn(
      async (deps: {
        judgeDeletions: (deletions: readonly unknown[]) => Promise<void>;
      }) => {
        // The same change as agreed passes; another change to the column does not.
        await deps.judgeDeletions([typeChange]);
        await deps.judgeDeletions([madeRequired]);
        return { changed: true };
      }
    );

    await expect(
      runReconcileCore(
        {
          adapter: adapter(),
          consent: resolveDataLossConsent({}),
          interactive: true,
          askToDelete: () => Promise.resolve(true),
          checkAppHistory: () => Promise.resolve(),
        },
        {
          reconcileCore: reconcile as never,
          planCoreDeletions: () => Promise.resolve([typeChange]),
        }
      )
    ).rejects.toThrow(/users\.name/);
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("at a terminal lists what it deletes and asks once; a no changes nothing", async () => {
    const reconcile = vi.fn();
    const askToDelete = vi.fn().mockResolvedValue(false);
    await expect(
      runReconcileCore(
        {
          adapter: adapter(),
          consent: resolveDataLossConsent({}),
          interactive: true,
          askToDelete,
          checkAppHistory: () => Promise.resolve(),
        },
        {
          reconcileCore: reconcile,
          planCoreDeletions: () => Promise.resolve(ACCESS_RULES),
        }
      )
    ).rejects.toMatchObject({});
    expect(askToDelete).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
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
          consent: resolveDataLossConsent({}),
          interactive: false,
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
      consent: resolveDataLossConsent({}),
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
          consent: resolveDataLossConsent({}),
          interactive: false,
          checkAppHistory: () => Promise.reject(refusal),
        },
        { reconcileCore: reconcile }
      )
    ).rejects.toBe(refusal);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
