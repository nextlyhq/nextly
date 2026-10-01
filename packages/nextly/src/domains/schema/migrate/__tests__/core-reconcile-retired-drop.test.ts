/**
 * Whether a requested retired-table drop actually reaches the database.
 *
 * Every assertion here is about REACHABILITY rather than about the SQL. The
 * planner in `init/retired-auth-tables` was already tested and already
 * correct; what nothing covered was whether `reconcileCore` ever calls it. It
 * did not — the guard returned on operations the CLI never supplied, and the
 * no-diff path returned before the cleanup — so the documented
 * `NEXTLY_ALLOW_CORE_DESTRUCTIVE` flow dropped nothing and reported nothing.
 */
import { describe, expect, it, vi } from "vitest";

import { getCoreSchema } from "../../../../schemas";
import { reconcileCore } from "../core-reconcile";

// The ledger write that follows a successful apply. Stubbed so the apply path
// can run without a database; nothing here is about what the ledger records.
vi.mock("../../events/schema-events-repository", () => ({
  SchemaEventsRepository: class {
    recordStart = () => Promise.resolve("event-1");
    markApplied = () => Promise.resolve();
  },
}));

/** The retired names, as the production planner knows them. */
const RETIRED = ["accounts", "sessions"];

function deps(over: Record<string, unknown> = {}) {
  const executed: string[] = [];
  return {
    executed,
    args: {
      db: {},
      dialect: "postgresql" as const,
      dropRetiredAuthTables: true,
      tableExists: (table: string) => Promise.resolve(RETIRED.includes(table)),
      // Both in the shape Nextly created them, so they are ours to drop.
      columnsOf: (table: string) =>
        Promise.resolve(
          table === "accounts"
            ? ["id", "user_id", "provider", "provider_account_id"]
            : ["session_token", "user_id", "expires"]
        ),
      countRows: () => Promise.resolve(0),
      executeSql: (sql: string) => {
        executed.push(sql);
        return Promise.resolve(undefined);
      },
      // The live snapshot IS the desired one, so the diff is empty and the
      // function takes its "up to date" path — the ordinary upgrade, and the
      // one where the cleanup used to be skipped. Returning an empty snapshot
      // instead would diff as "create every core table" and run the apply
      // path, which is a different branch and would not test this at all.
      introspect: () => Promise.resolve(getCoreSchema("postgresql", {})),
      applyCore: () => Promise.resolve({ statementsExecuted: [] as string[] }),
      ...over,
    },
  };
}

describe("a retired-table drop the operator asked for", () => {
  it("runs even when the core schema needs no other change", async () => {
    // The separating property. The retired tables are not in the core schema,
    // so the diff can never mention them: "up to date" says nothing about
    // them, and returning there skipped the drop on exactly the databases
    // that still had the tables.
    const { args, executed } = deps();
    await reconcileCore(args as never);

    expect(executed).toHaveLength(2);
    expect(executed.join(" ")).toContain("accounts");
    expect(executed.join(" ")).toContain("sessions");
  });

  it("emits each DROP through the dialect's own generator", async () => {
    // PostgreSQL appends CASCADE and the others do not. Asserting the
    // dialect's spelling is what shows the shared emitter was used rather
    // than a string composed here — the two disagree on exactly this.
    const { args, executed } = deps();
    await reconcileCore(args as never);

    for (const sql of executed) {
      expect(sql).toMatch(/^DROP TABLE "(accounts|sessions)" CASCADE$/);
    }
  });

  it("says so, and changes nothing, when the caller cannot run one", async () => {
    // A caller without these operations cannot do this work, and must not be
    // refused for it. It is noted instead, because the silent version is
    // indistinguishable from a database with no retired tables left.
    const { args, executed } = deps();
    const said: string[] = [];
    const crippled = {
      ...args,
      tableExists: undefined,
      logger: { info: (m: string) => said.push(m) },
    };

    await reconcileCore(crippled as never);
    expect(executed).toEqual([]);
    expect(said.join(" ")).toMatch(/Retired-table cleanup skipped/);
  });

  it("does nothing at all when the operator did not ask", async () => {
    // The control: a cleanup that ran unconditionally would pass every test
    // above while dropping tables nobody consented to lose.
    const { args, executed } = deps({ dropRetiredAuthTables: false });
    await reconcileCore(args as never);

    expect(executed).toEqual([]);
  });

  it("is not asked for by accepting destructive core changes", async () => {
    // That flag accepts changes to the core schema; dropping these tables is
    // a different decision with a flag of its own.
    const { args, executed } = deps({
      dropRetiredAuthTables: false,
      allowDestructive: true,
    });
    await reconcileCore(args as never);

    expect(executed).toEqual([]);
  });

  it("keeps a table that still holds rows unless that is allowed too, and says so", async () => {
    const warned: string[] = [];
    const { args, executed } = deps({
      countRows: () => Promise.resolve(3),
      logger: { info: () => {}, warn: (m: string) => warned.push(m) },
    });
    await expect(reconcileCore(args as never)).resolves.toEqual({
      changed: false,
    });
    expect(executed).toEqual([]);
    expect(warned.join(" ")).toMatch(/still hold rows/);
  });

  it("drops the empty table even when the other one holds rows", async () => {
    const { args, executed } = deps({
      countRows: (_db: unknown, _dialect: unknown, table: string) =>
        Promise.resolve(table === "accounts" ? 3 : 0),
    });
    await reconcileCore(args as never);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("sessions");
  });

  it("does not report the schema up to date without saying what it dropped", async () => {
    const said: string[] = [];
    const { args } = deps({
      logger: { info: (m: string) => said.push(m), warn: () => {} },
    });
    await reconcileCore(args as never);

    expect(said.join(" ")).toMatch(
      /dropped retired auth tables: accounts, sessions/
    );
  });

  it("drops a non-empty table once the second flag is set", async () => {
    const { args, executed } = deps({
      countRows: () => Promise.resolve(3),
      allowDropNonEmptyRetired: true,
    });
    await reconcileCore(args as never);
    expect(executed).toHaveLength(2);
  });

  describe("when the core schema also needs changing", () => {
    // An empty live snapshot diffs as "create every core table", so these take
    // the apply path rather than the "up to date" one above.
    const needsApply = { introspect: () => Promise.resolve({ tables: [] }) };

    it("drops only after the core apply has run", async () => {
      const order: string[] = [];
      const { args } = deps({
        ...needsApply,
        applyCore: () => {
          order.push("apply");
          return Promise.resolve({ statementsExecuted: [] as string[] });
        },
        executeSql: (sql: string) => {
          order.push(sql.startsWith("DROP") ? "drop" : sql);
          return Promise.resolve(undefined);
        },
      });

      await expect(reconcileCore(args as never)).resolves.toEqual({
        changed: true,
      });
      expect(order).toEqual(["apply", "drop", "drop"]);
    });

    it("applies the core change even when a retired table holds rows", async () => {
      // The cleanup is opt-in housekeeping; a table it may not drop must not
      // hold back a core change that has nothing to do with it.
      let applied = false;
      const { args, executed } = deps({
        ...needsApply,
        countRows: () => Promise.resolve(3),
        applyCore: () => {
          applied = true;
          return Promise.resolve({ statementsExecuted: [] as string[] });
        },
      });

      await expect(reconcileCore(args as never)).resolves.toEqual({
        changed: true,
      });
      expect(applied).toBe(true);
      expect(executed).toEqual([]);
    });

    it("counts the rows after the apply, not before", async () => {
      // Empty before the apply, holding rows by the drop: the operator agreed
      // to lose an empty table, not this one.
      let applied = false;
      const { args, executed } = deps({
        ...needsApply,
        countRows: () => Promise.resolve(applied ? 3 : 0),
        applyCore: () => {
          applied = true;
          return Promise.resolve({ statementsExecuted: [] as string[] });
        },
      });

      await reconcileCore(args as never);
      expect(executed).toEqual([]);
    });

    it("leaves the retired tables in place when the core apply fails", async () => {
      // The drop cannot be undone and the apply can fail. Dropping first, a
      // failed apply leaves the database without those rows and without the
      // core update.
      const { args, executed } = deps({
        ...needsApply,
        applyCore: () => Promise.reject(new Error("push failed")),
      });

      await expect(reconcileCore(args as never)).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
      });
      expect(executed).toEqual([]);
    });
  });
});
