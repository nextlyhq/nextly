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
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { getCoreSchema } from "../../../../schemas";
import { reconcileCore } from "../core-reconcile";

/** The retired names, as the production planner knows them. */
const RETIRED = ["accounts", "sessions"];

function deps(over: Record<string, unknown> = {}) {
  const executed: string[] = [];
  return {
    executed,
    args: {
      db: {},
      dialect: "postgresql" as const,
      allowDestructive: true,
      tableExists: (table: string) => Promise.resolve(RETIRED.includes(table)),
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
    // `allowDestructive` also authorises unrelated destructive changes, so a
    // caller without these operations is not asking for this work and must
    // not be refused. It is noted instead, because the silent version is
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
    const { args, executed } = deps({ allowDestructive: false });
    await reconcileCore(args as never);

    expect(executed).toEqual([]);
  });

  it("refuses a table that still holds rows unless that is allowed too", async () => {
    const { args, executed } = deps({ countRows: () => Promise.resolve(3) });
    await expect(reconcileCore(args as never)).rejects.toThrow(NextlyError);
    expect(executed).toEqual([]);
  });

  it("drops a non-empty table once the second flag is set", async () => {
    const { args, executed } = deps({
      countRows: () => Promise.resolve(3),
      allowDropNonEmptyRetired: true,
    });
    await reconcileCore(args as never);
    expect(executed).toHaveLength(2);
  });
});
