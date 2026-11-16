import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { MetaService } from "../../../meta/services/meta-service";
import { runMigrationSteps, type MigrationStep } from "../runner";
import type { MigrationSession } from "../session";

// A per-lock timeout as each driver reports it: PostgreSQL's lock_not_available, MySQL's
// ER_LOCK_WAIT_TIMEOUT.
const PG_LOCK_TIMEOUT = Object.assign(new Error("canceling statement"), {
  code: "55P03",
});
const MYSQL_LOCK_TIMEOUT = Object.assign(new Error("Lock wait timeout"), {
  code: "ER_LOCK_WAIT_TIMEOUT",
  errno: 1205,
});

// Short bounds, so a second try fits after the first pause of about a second, and no third.
const BOUNDS = { tryMs: 100, totalMs: 1_500 };

/** The adapter the tries ask of: no triggers anywhere. */
const ADAPTER = {
  getCapabilities: () => ({ dialect: "postgresql" }),
  queryStatement: async () => [{ seen: 1 }],
} as unknown as DrizzleAdapter;

/** A session whose transactions run `work` on a context that records what it was sent. */
function sessionOf(
  dialect: MigrationSession["dialect"],
  sent: string[],
  fail: (statement: string) => Error | undefined
): MigrationSession {
  const ctx = {
    execute: async (statement: string) => {
      sent.push(statement);
      const error = fail(statement);
      if (error !== undefined) throw error;
      return statement.startsWith("SELECT @@SESSION")
        ? [{ lock_wait: 50, row_wait: 7 }]
        : [];
    },
    runStatement: async () => {
      sent.push("<row change>");
    },
  };
  return {
    dialect,
    inTransaction: async work => work(ctx as never),
    lock: { kind: "held", owner: "test" },
  } as MigrationSession;
}

/** A step that renames one table, as the plan's rename steps do. */
function renameStep(runs: { count: number }): MigrationStep {
  return {
    id: "table:comp_hero->fg_hero",
    changesStructure: true,
    async run(session) {
      runs.count += 1;
      await session.inTransaction(async ctx => {
        await ctx.execute('ALTER TABLE "comp_hero" RENAME TO "fg_hero"');
        await ctx.runStatement(
          sql`UPDATE ${sql.identifier("dynamic_components")} SET table_name = ${"fg_hero"}`
        );
      });
    },
    verify: async () => true,
  };
}

const meta = {} as MetaService;

/** Runs `steps` with the busy-table tries; markers are not written by a step that never verifies. */
function run(
  session: MigrationSession,
  steps: MigrationStep[],
  notify: (line: string) => void,
  options: { direction?: "up" | "down"; adapter?: DrizzleAdapter } = {}
): Promise<void> {
  const direction = options.direction ?? "up";
  return runMigrationSteps({
    session,
    meta,
    migrationId: "m",
    steps: steps.map(step => ({ ...step, recordsProgress: false })),
    fromStep: 1,
    busyTable: {
      adapter: options.adapter ?? ADAPTER,
      bounds: BOUNDS,
      notify,
      command: `nextly migrate:field-groups --apply (${direction})`,
      direction,
    },
  });
}

describe("a field-group migration step waits for a busy table in tries", () => {
  it("bounds each lock wait of the step's transaction and tries the step again", async () => {
    const sent: string[] = [];
    let failed = false;
    const session = sessionOf("postgresql", sent, statement => {
      if (!failed && statement.startsWith("ALTER TABLE")) {
        failed = true;
        return PG_LOCK_TIMEOUT;
      }
      return undefined;
    });
    const runs = { count: 0 };
    const notices: string[] = [];
    await run(session, [renameStep(runs)], line => notices.push(line));
    expect(runs.count).toBe(2);
    expect(sent.filter(s => s.startsWith("SET LOCAL lock_timeout"))).toEqual([
      "SET LOCAL lock_timeout = '100ms'",
      "SET LOCAL lock_timeout = '100ms'",
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('table "comp_hero" is busy');
    expect(notices[0]).toContain("does not look up the session");
    expect(notices[0]).toContain("try 2 of up to 2");
  }, 10_000);

  it("stops with NEXTLY_TABLE_BUSY, nothing changed, once the tries run out", async () => {
    const sent: string[] = [];
    const session = sessionOf("postgresql", sent, statement =>
      statement.startsWith("ALTER TABLE") ? PG_LOCK_TIMEOUT : undefined
    );
    const runs = { count: 0 };
    const error = await run(session, [renameStep(runs)], () => {}).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(NextlyError.isCode(error, "NEXTLY_TABLE_BUSY")).toBe(true);
    const stop = (error as NextlyError).logContext?.stop as {
      tries: number;
      outcome: { kind: string };
      change: string;
    };
    expect(stop.tries).toBe(2);
    expect(stop.outcome.kind).toBe("nothing-changed");
    expect(stop.change).toBe(
      "nextly migrate:field-groups --apply (up): step 1 of 1 (table:comp_hero->fg_hero)"
    );
  }, 10_000);

  it("on MySQL, bounds metadata and row waits and puts back the session's own values", async () => {
    const sent: string[] = [];
    const session = sessionOf("mysql", sent, () => undefined);
    await run(session, [renameStep({ count: 0 })], () => {});
    expect(sent.filter(s => s.startsWith("SET SESSION"))).toEqual([
      "SET SESSION lock_wait_timeout = 1",
      "SET SESSION innodb_lock_wait_timeout = 1",
      "SET SESSION lock_wait_timeout = 50",
      "SET SESSION innodb_lock_wait_timeout = 7",
    ]);
  });

  it("on MySQL, reports a rename that committed before a later wait as part-way", async () => {
    const sent: string[] = [];
    const session = sessionOf("mysql", sent, statement =>
      statement.includes('"comp_a_t"') ? MYSQL_LOCK_TIMEOUT : undefined
    );
    // Two renames: the first commits on its own, the second waits on every try. A later try finds
    // the first already renamed, as the step's catalog read would.
    let renamed = false;
    const step: MigrationStep = {
      id: "table:comp_a->fg_a",
      changesStructure: true,
      async run(s) {
        await s.inTransaction(async ctx => {
          if (!renamed) {
            await ctx.execute('ALTER TABLE "comp_a" RENAME TO "fg_a"');
            renamed = true;
          }
          await ctx.execute('ALTER TABLE "comp_a_t" RENAME TO "fg_a_t"');
        });
      },
      verify: async () => true,
    };
    const error = await run(session, [step], () => {}).then(
      () => undefined,
      (e: unknown) => e
    );
    const stop = (error as NextlyError).logContext?.stop as {
      outcome: { kind: string; committed?: number[] };
    };
    expect(stop.outcome).toEqual({ kind: "part-way", committed: [1] });
  }, 10_000);

  it("runs a step that only rewrites rows once, with no bound of its own", async () => {
    const sent: string[] = [];
    const session = sessionOf("postgresql", sent, () => undefined);
    const rows: MigrationStep = {
      id: "data:ledger",
      run: vi.fn(async (s: MigrationSession) => {
        await s.inTransaction(async () => undefined);
      }),
      verify: async () => true,
    };
    await run(session, [rows], () => {});
    expect(sent).toEqual([]);
  });

  it("ends its stop with this command's next step, not a migration file's", async () => {
    const session = sessionOf("postgresql", [], statement =>
      statement.startsWith("ALTER TABLE") ? PG_LOCK_TIMEOUT : undefined
    );
    const error = (await run(session, [renameStep({ count: 0 })], () => {}, {
      direction: "down",
    }).then(
      () => undefined,
      (e: unknown) => e
    )) as NextlyError;
    expect(error.code).toBe("NEXTLY_TABLE_BUSY");
    const lines = error.publicMessage.split("\n");
    expect(lines[lines.length - 1]).toContain(
      "`nextly migrate:field-groups --down --apply --backup-confirmed` again"
    );
    expect(lines[lines.length - 1]).toContain(
      "resumes from the step that stopped"
    );
    expect(error.publicMessage).not.toContain("migrate:resolve");
    expect(error.publicMessage).not.toContain("--lock-timeout");
    expect(error.logContext?.stop).toMatchObject({ direction: "down" });
  }, 10_000);

  it("on MySQL, says the rest was undone where the try sent only row changes and kept nothing", async () => {
    // Every table has a trigger, so a row change that waited may not be sent again.
    const triggered = {
      ...ADAPTER,
      queryStatement: async () => [{ seen: 1, name: "dynamic_components" }],
    } as unknown as DrizzleAdapter;
    const session = sessionOf("mysql", [], () => undefined);
    const rowsOnly: MigrationStep = {
      id: "table:comp_hero->fg_hero",
      changesStructure: true,
      async run(s) {
        await s.inTransaction(async ctx => {
          await ctx.runStatement(
            sql`UPDATE ${sql.identifier("dynamic_components")} SET table_name = ${"fg_hero"}`
          );
          throw MYSQL_LOCK_TIMEOUT;
        });
      },
      verify: async () => true,
    };
    const error = (await run(session, [rowsOnly], () => {}, {
      adapter: triggered,
    }).then(
      () => undefined,
      (e: unknown) => e
    )) as NextlyError;
    expect(error.logContext?.stop).toMatchObject({
      outcome: { kind: "no-retry", reason: "trigger", restUndone: true },
    });
  });
});
