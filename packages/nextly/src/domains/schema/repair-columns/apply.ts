// `nextly repair-columns --apply`: convert each column that is safe now towards its field as last
// applied, and record each repair.
//
// The run takes the one schema lock, waiting for it as a command-line run does, and reads and
// classes every difference again under it, so it acts on what the database holds now rather than
// on an earlier report. It first finishes any conversion an earlier run left at a recorded step,
// then converts the safe columns one at a time. Every other column (pending a migration, a
// plugin's, blocked, lossy without consent, unreadable) is left exactly as it was, with its reason.
// One column's failure stops neither the others nor the report.
//
// How a column converts depends on what the database lets one change hold:
// - PostgreSQL: one transaction closes the table (the lock the type change takes anyway), judges
//   the rows again, converts and writes the record, so no write comes between the judgement and
//   the change, and any failure leaves the column exactly as it was.
// - SQLite: the same, in one transaction holding the database's write lock.
// - MySQL: each schema statement commits on its own. The column is judged again, its progress is
//   recorded before the first step and moved on after each one, and every step runs in strict mode,
//   so a value written since the judgement is refused rather than stored differently. A stop
//   between two commits leaves a recorded step the next run finishes from the live column.
//
// A conversion waits for its table one bounded try, then leaves the column as it was (or at its
// last committed step) and is reported as unavailable, locked (or interrupted), and the run goes
// on. On SQLite, whose one writer holds every table, no further conversion tries in that run.
//
// @module domains/schema/repair-columns/apply

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { executeTransaction } from "../migrate/migration-transaction";
import { withSchemaLock } from "../pipeline/schema-lock";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import type { SupportedDialect } from "../services/field-column-descriptor";

import { classifyDifference } from "./classify";
import { findColumnDifferences } from "./find-differences";
import {
  findingClass,
  NO_RUN_FACTS,
  type ColumnRunFacts,
  type TableLockFacts,
} from "./outcome";
import {
  deleteRepair,
  ensureColumnRepairsTable,
  insertRepair,
  readUnfinishedRepairs,
  recordStep,
  type RecordedProgress,
  type RepairFacts,
} from "./record";
import { repairRecord, type RepairRecord } from "./report";
import { reportDocument, type RepairColumnsDocument } from "./report-json";
import {
  isAt,
  liveStateFor,
  liveStepOf,
  noStepReason,
  progressFinding,
  stepName,
} from "./resume";
import type { ColumnFinding, DiffersFinding, RepairEntity } from "./types";

/** The command the schema lock names while a repair holds it. */
const APPLY_COMMAND = "nextly repair-columns --apply";

/** How long one try waits for a table another session is using, about 5 seconds. */
export const TABLE_TRY_MS = 5_000;

/** Where a conversion is about to run one of its steps. */
export interface ConversionStepAt {
  table: string;
  column: string;
  /** The step about to run, counted from 0. */
  step: number;
}

export interface ApplyRepairsArgs {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  entities: readonly RepairEntity[];
  nextlyVersion: string;
  /** How long to wait for the schema lock; the lock's own wait for a command-line run when left out. */
  schemaLockWaitMs?: number;
  /** How long one try waits for a table in use; {@link TABLE_TRY_MS} when left out. */
  tableTryMs?: number;
  /**
   * Called before each step of each conversion runs. A test uses it to stop a run at a chosen
   * step; an error it throws fails that column as a database's refusal would.
   */
  beforeStep?: (at: ConversionStepAt) => Promise<void>;
}

/** A column's finding as this run last judged it, and what the run established about it. */
interface Converted {
  finding: ColumnFinding;
  facts: ColumnRunFacts;
}

/** Convert every safe column and finish every unfinished conversion. Returns the run's document. */
export async function applyRepairs(
  args: ApplyRepairsArgs
): Promise<RepairColumnsDocument> {
  const held = await withSchemaLock(
    {
      adapter: args.adapter,
      command: APPLY_COMMAND,
      whenHeld: "wait",
      ...(args.schemaLockWaitMs !== undefined
        ? { waitMs: args.schemaLockWaitMs }
        : {}),
    },
    () => new ApplyRun(args).run()
  );
  if (!held.ran) {
    // Only a lock taken with `isSettled` can end without running, and this one is not.
    throw NextlyError.internal({
      logContext: {
        reason: "the schema lock ended a repair without running it",
      },
    });
  }
  return held.value;
}

/** Whether a finding is a difference this run converts: safe, with statements, owned by no plugin. */
function convertible(finding: ColumnFinding): finding is DiffersFinding {
  return (
    finding.kind === "differs" &&
    finding.plugin === undefined &&
    findingClass(finding) === "safe" &&
    finding.conversion !== null &&
    finding.conversion.steps.length > 0
  );
}

/** The record facts of a repair about to run. */
function repairFacts(finding: DiffersFinding): RepairFacts {
  return {
    table: finding.judged?.liveTable ?? finding.location.table,
    column: finding.judged?.liveColumn ?? finding.location.column,
    from: finding.live,
    to: finding.expected,
    class: "safe",
    consent: false,
    valuesCleared: 0,
  };
}

/** The codes and messages a database gives when a statement waited out its lock timeout. */
function waitedOutTable(error: unknown): boolean {
  let link: unknown = error;
  for (
    let depth = 0;
    depth < 6 && typeof link === "object" && link !== null;
    depth++
  ) {
    const { code, errno, message } = link as {
      code?: unknown;
      errno?: unknown;
      message?: unknown;
    };
    // PostgreSQL lock_not_available, MySQL ER_LOCK_WAIT_TIMEOUT, SQLite busy or locked.
    if (code === "55P03" || code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1205) {
      return true;
    }
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
    if (
      typeof message === "string" &&
      /lock timeout|lock wait timeout exceeded|database (?:table )?is locked/i.test(
        message
      )
    ) {
      return true;
    }
    link = (link as { cause?: unknown }).cause;
  }
  return false;
}

/** The database's reason for a failure, as its message gives it. */
function reasonOf(error: unknown): string {
  let link: unknown = error;
  let reason = "";
  for (
    let depth = 0;
    depth < 6 && typeof link === "object" && link !== null;
    depth++
  ) {
    const { message } = link as { message?: unknown };
    if (typeof message === "string" && message !== "") reason = message;
    link = (link as { cause?: unknown }).cause;
  }
  return reason === "" ? "the database refused the conversion" : reason;
}

/** One run of `--apply`, under the schema lock. */
class ApplyRun {
  private readonly adapter: DrizzleAdapter;
  private readonly dialect: SupportedDialect;
  private readonly tryMs: number;
  private repairsTableReady = false;
  /** SQLite's one writer was held past a try: no further conversion tries this run. */
  private databaseHeld = false;

  constructor(private readonly args: ApplyRepairsArgs) {
    this.adapter = args.adapter;
    this.dialect = args.dialect;
    this.tryMs = args.tableTryMs ?? TABLE_TRY_MS;
  }

  private get db(): unknown {
    return this.adapter.getDrizzle();
  }

  async run(): Promise<RepairColumnsDocument> {
    const unfinished = await readUnfinishedRepairs(this.db, this.dialect);
    const findings = await findColumnDifferences({
      db: this.db,
      dialect: this.dialect,
      entities: this.args.entities,
    });
    const records: RepairRecord[] = [];
    // Each unfinished conversion first, before any other column converts.
    for (const progress of unfinished) {
      const done = await this.resume(progress, findings);
      records.push(repairRecord(done.finding, done.facts, "apply"));
    }
    for (const finding of findings) {
      const resumed =
        finding.kind === "differs" &&
        unfinished.some(p => isAt(finding, p.table, p.column));
      if (resumed) continue;
      const done = await this.columnOutcome(finding);
      records.push(repairRecord(done.finding, done.facts, "apply"));
    }
    return reportDocument({
      nextlyVersion: this.args.nextlyVersion,
      mode: "apply",
      dialect: this.dialect,
      // This run holds the lock, so no other schema change is running.
      schemaLock: { state: "free", holder: null, unreadable: null },
      records,
      warnings: [],
    });
  }

  /** One column of this run: converted where it is safe, otherwise reported as it is. */
  private async columnOutcome(finding: ColumnFinding): Promise<Converted> {
    if (!convertible(finding)) return { finding, facts: NO_RUN_FACTS };
    if (this.databaseHeld) {
      return {
        finding,
        facts: { ...NO_RUN_FACTS, lock: this.lockFacts(finding, 0, 0) },
      };
    }
    try {
      await this.ensureRepairsTable();
      return this.dialect === "mysql"
        ? await this.convertInSteps(finding)
        : await this.convertInTransaction(finding);
    } catch (error) {
      // Anything that stops the column before its first step, such as its progress record
      // being refused, fails that column alone, which is exactly as it was.
      return {
        finding,
        facts: {
          ...NO_RUN_FACTS,
          failure: { reason: reasonOf(error), heldStep: null },
        },
      };
    }
  }

  private async ensureRepairsTable(): Promise<void> {
    if (this.repairsTableReady) return;
    await ensureColumnRepairsTable(this.adapter, this.dialect);
    this.repairsTableReady = true;
  }

  /** The finding judged again from the rows `db` reads now. */
  private async rejudge(
    db: unknown,
    finding: DiffersFinding
  ): Promise<DiffersFinding> {
    if (finding.judged === undefined) {
      throw NextlyError.internal({
        logContext: {
          reason: "a difference to convert carries no judgement subject",
          table: finding.location.table,
          column: finding.location.column,
        },
      });
    }
    const judgement = await classifyDifference(
      db,
      this.dialect,
      finding.judged
    );
    return { ...finding, judgement };
  }

  private async step(finding: DiffersFinding, step: number): Promise<void> {
    await this.args.beforeStep?.({
      table: finding.location.table,
      column: finding.location.column,
      step,
    });
  }

  /**
   * PostgreSQL and SQLite: the judgement, the conversion and its record in one transaction, which
   * any failure rolls back whole.
   */
  private async convertInTransaction(
    finding: DiffersFinding
  ): Promise<Converted> {
    const started = Date.now();
    const table = quoteIdent(
      finding.judged?.liveTable ?? finding.location.table,
      this.dialect
    );
    const steps = finding.conversion?.steps ?? [];
    const restoreBusyTimeout = await this.boundSqliteWait();
    try {
      return await executeTransaction(this.adapter, async tx => {
        if (this.dialect === "postgresql") {
          // The table is closed first, as the type change closes it anyway, so no write comes
          // between the judgement below and the change; the wait for it is one bounded try.
          await tx.execute(
            `SET LOCAL lock_timeout = '${String(this.tryMs)}ms'`
          );
          await tx.execute(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
        }
        const now = await this.rejudge(tx.db, finding);
        if (findingClass(now) !== "safe")
          return { finding: now, facts: NO_RUN_FACTS };
        for (const [index, group] of steps.entries()) {
          await this.step(now, index);
          for (const statement of group) await tx.execute(statement);
        }
        await insertRepair(tx.db, this.dialect, repairFacts(now), {
          state: "converted",
          step: steps.length,
          steps: steps.length,
        });
        return { finding: now, facts: { ...NO_RUN_FACTS, converted: true } };
      });
    } catch (error) {
      if (waitedOutTable(error)) {
        if (this.dialect === "sqlite") this.databaseHeld = true;
        return {
          finding,
          facts: {
            ...NO_RUN_FACTS,
            lock: this.lockFacts(finding, 1, Date.now() - started),
          },
        };
      }
      return {
        finding,
        facts: {
          ...NO_RUN_FACTS,
          failure: { reason: reasonOf(error), heldStep: null },
        },
      };
    } finally {
      await restoreBusyTimeout();
    }
  }

  /**
   * On SQLite, bound the wait for the database's write lock to one try for this conversion, and
   * return what puts the connection's own wait back. Nothing to do elsewhere.
   */
  private async boundSqliteWait(): Promise<() => Promise<void>> {
    if (this.dialect !== "sqlite") return () => Promise.resolve();
    const [row] = (await this.adapter.executeQuery(
      "PRAGMA busy_timeout"
    )) as Array<Record<string, unknown>>;
    const previous = Number(Object.values(row ?? {})[0] ?? 0);
    await this.adapter.executeQuery(
      `PRAGMA busy_timeout = ${String(this.tryMs)}`
    );
    return async () => {
      await this.adapter.executeQuery(
        `PRAGMA busy_timeout = ${String(Number.isFinite(previous) ? previous : 0)}`
      );
    };
  }

  /**
   * MySQL: judge again, record the progress, then run each step, moving the record on after each
   * commit.
   */
  private async convertInSteps(finding: DiffersFinding): Promise<Converted> {
    const now = await this.rejudge(this.db, finding);
    if (findingClass(now) !== "safe")
      return { finding: now, facts: NO_RUN_FACTS };
    const steps = now.conversion?.steps ?? [];
    const rowId = await insertRepair(this.db, this.dialect, repairFacts(now), {
      state: "in-progress",
      step: 0,
      steps: steps.length,
    });
    return this.runSteps(now, rowId, 0, steps);
  }

  /** Run `steps` from `from` on one strict-mode session, recording each committed step. */
  private async runSteps(
    finding: DiffersFinding,
    rowId: string,
    from: number,
    steps: readonly (readonly string[])[]
  ): Promise<Converted> {
    const started = Date.now();
    const total = steps.length;
    let reached = from;
    try {
      await this.adapter.withSession(
        async session => {
          // One bounded try for the table's metadata lock, for every statement of this session.
          await session.execute(
            `SET SESSION lock_wait_timeout = ${String(Math.max(1, Math.ceil(this.tryMs / 1000)))}`
          );
          for (let index = from; index < total; index++) {
            await this.step(finding, index);
            for (const statement of steps[index])
              await session.execute(statement);
            reached = index + 1;
            await recordStep(this.db, this.dialect, rowId, reached, total);
          }
        },
        { strictSqlMode: true }
      );
      return { finding, facts: { ...NO_RUN_FACTS, converted: true } };
    } catch (error) {
      return this.stoppedAt(
        finding,
        rowId,
        from,
        reached,
        total,
        error,
        started
      );
    }
  }

  /** What a conversion that stopped at step `reached` of `total` leaves, and its outcome. */
  private async stoppedAt(
    finding: DiffersFinding,
    rowId: string,
    from: number,
    reached: number,
    total: number,
    error: unknown,
    started: number
  ): Promise<Converted> {
    const busy = waitedOutTable(error);
    if (reached === 0) {
      // Nothing committed: the column is exactly as it was, so its progress is removed.
      await deleteRepair(this.db, this.dialect, rowId).catch(() => undefined);
      return {
        finding,
        facts: busy
          ? {
              ...NO_RUN_FACTS,
              lock: this.lockFacts(finding, 1, Date.now() - started),
            }
          : {
              ...NO_RUN_FACTS,
              failure: { reason: reasonOf(error), heldStep: null },
            },
      };
    }
    const held = stepName(reached, total);
    if (busy) {
      return {
        finding,
        facts: {
          ...NO_RUN_FACTS,
          lock: this.lockFacts(finding, 1, Date.now() - started),
          progress: { recordedStep: held, liveStep: held },
        },
      };
    }
    return {
      finding,
      facts: {
        ...NO_RUN_FACTS,
        failure: { reason: reasonOf(error), heldStep: held },
        progress:
          reached > from ? { recordedStep: held, liveStep: held } : null,
      },
    };
  }

  /**
   * Finish a conversion an earlier run left at a recorded step, from the step its live column has
   * reached.
   */
  private async resume(
    progress: RecordedProgress,
    findings: readonly ColumnFinding[]
  ): Promise<Converted> {
    const live = liveStateFor(progress, findings);
    const finding = progressFinding(
      progress,
      findings,
      this.args.entities,
      live
    );
    const reached = await liveStepOf(this.db, this.dialect, progress, live);
    const recordedStep = stepName(progress.step, progress.steps);
    if (reached === null) {
      return {
        finding,
        facts: {
          ...NO_RUN_FACTS,
          progress: { recordedStep, liveStep: null },
          failure: { reason: noStepReason(progress, live), heldStep: null },
        },
      };
    }
    if (reached === progress.steps) {
      // The column already holds its field's definition: only the record is behind.
      await recordStep(
        this.db,
        this.dialect,
        progress.id,
        reached,
        progress.steps
      );
      return { finding, facts: { ...NO_RUN_FACTS, converted: true } };
    }
    const interrupted: Converted = {
      finding,
      facts: {
        ...NO_RUN_FACTS,
        progress: { recordedStep, liveStep: stepName(reached, progress.steps) },
      },
    };
    if (finding.judged === undefined || finding.conversion === null)
      return interrupted;
    const now = await this.rejudge(this.db, finding);
    const steps = now.conversion?.steps ?? [];
    // The conversion the column needs now must be the one its record began; anything else is
    // left for its owner, never run in its place.
    if (findingClass(now) !== "safe" || steps.length !== progress.steps) {
      return { ...interrupted, finding: now };
    }
    if (reached !== progress.step) {
      await recordStep(
        this.db,
        this.dialect,
        progress.id,
        reached,
        progress.steps
      );
    }
    return this.runSteps(now, progress.id, reached, steps);
  }

  /** The lock facts of a conversion whose table another session held through `tries` tries. */
  private lockFacts(
    finding: ColumnFinding,
    tries: number,
    waitedMs: number
  ): TableLockFacts {
    const wholeDatabase = this.dialect === "sqlite";
    return {
      table: finding.location.table,
      tries,
      waitedMs,
      holder: {
        sessions: [],
        couldNotRead: {
          details: [
            wholeDatabase
              ? "which connection holds the database"
              : "which session holds the table",
          ],
          why: wholeDatabase
            ? "SQLite reports only that the database is locked, not who holds it"
            : "this run does not read the sessions holding a table",
        },
        wholeDatabase,
      },
      nextStep:
        tries === 0
          ? "run `nextly repair-columns --apply` again once the connection holding the database ends"
          : "run `nextly repair-columns --apply` again once the session using the table ends",
    };
  }
}
