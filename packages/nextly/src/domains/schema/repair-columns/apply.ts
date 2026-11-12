// `nextly repair-columns --apply`: convert each column that is safe now towards its field as last
// applied, convert a lossy one only under a consent that names it, and record each repair.
//
// The run takes the one schema lock, waiting for it as a command-line run does, and reads and
// classes every difference again under it, so it acts on what the database holds now rather than
// on an earlier report. It first finishes any conversion an earlier run left at a recorded step,
// then converts the safe columns one at a time. Every other column (pending a migration, a
// plugin's, blocked, lossy without consent, unreadable) is left exactly as it was, with its reason.
// One column's failure stops neither the others nor the report.
//
// A lossy column holds values the new type cannot hold. It converts only when the data-loss consent
// names it as `table.column`, or the person at the terminal says yes to clearing its values; a
// consent without a list, or naming only the table, never covers it (`consent.ts`). The question is
// asked once the column has been judged under the schema lock and before its table is closed, so
// the table is never held while a person answers. The values cleared, set to null, are exactly the
// rows the run's judgement named, read from the same pass over the column that classed it; where
// the rows a yes was given for are no longer all of them, nothing is cleared and the column is
// skipped. A difference that is both lossy and blocked is blocked, and nothing is cleared for it.
//
// How a column converts depends on what the database lets one change hold:
// - PostgreSQL: one transaction closes the table (the lock the type change takes anyway), judges
//   the rows again, clears the named values, converts and writes the record, so no write comes
//   between the judgement and the change, and any failure leaves the column exactly as it was.
// - SQLite: the same, in one transaction holding the database's write lock; the values are
//   cleared once the table is rebuilt, in the same transaction.
// - MySQL: each schema statement commits on its own. The column is judged again, its progress is
//   recorded before the first step and moved on after each one, and every step runs in strict mode,
//   so a value written since the judgement is refused rather than stored differently. A lossy
//   column's first step is its clearing, which commits in one transaction with its record and its
//   count. A stop between two commits leaves a recorded step the next run finishes from the live
//   column; a clearing still to run needs that run's own consent.
//
// A conversion waits for its table one bounded try, then leaves the column as it was (or at its
// last committed step) and is reported as unavailable, locked (or interrupted), and the run goes
// on. On SQLite, whose one writer holds every table, no further conversion tries in that run.
//
// @module domains/schema/repair-columns/apply

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

import { NextlyError } from "../../../errors/nextly-error";
import { NO_CONSENT, type DataLossConsent } from "../migrate/data-loss-consent";
import { executeTransaction } from "../migrate/migration-transaction";
import { mysqlReferenceListNormalise } from "../pipeline/reference-list-conversion";
import { withSchemaLock } from "../pipeline/schema-lock";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import type { SupportedDialect } from "../services/field-column-descriptor";
import { reasonClass } from "../value-conversion/judge-column";
import { rowKeyOf } from "../value-conversion/read-values";
import type {
  ConversionClass,
  ConversionReasonKind,
  RowKey,
} from "../value-conversion/types";

import { classifyDifference } from "./classify";
import {
  clearingStatements,
  rowKeyText,
  stillNotJsonQueries,
} from "./clearing";
import { compareColumn } from "./column-comparison";
import { consentForColumn } from "./consent";
import { findColumnDifferences } from "./find-differences";
import {
  findingClass,
  NO_RUN_FACTS,
  type ColumnConsentFacts,
  type ColumnRunFacts,
  type TableLockFacts,
} from "./outcome";
import {
  clearedStepStatement,
  deleteRepair,
  ensureColumnRepairsTable,
  insertRepair,
  readUnfinishedRepairs,
  recordStep,
  runSql,
  type RecordedProgress,
  type RepairFacts,
} from "./record";
import { repairRecord, type RepairRecord } from "./report";
import { reportDocument, type RepairColumnsDocument } from "./report-json";
import {
  clearsFirst,
  isAt,
  LIST_CONVERSION_STEPS,
  liveStepOf,
  noStepReason,
  notResumed,
  progressFinding,
  progressStepName,
  readLiveState,
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
  /** The step about to run, counted from 0. On MySQL a lossy column's step 0 is its clearing. */
  step: number;
}

/** What the person at the terminal is asked before a lossy column's values are cleared. */
export interface ClearingQuestion {
  table: string;
  column: string;
  /** How many values would be cleared. */
  count: number;
  /** The first rows that hold them, by key, up to the bound the report names. */
  first: RowKey[];
  /** Why each would be cleared. */
  reasons: ConversionReasonKind[];
}

export interface ApplyRepairsArgs {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  /**
   * The entities to compare, or how to read them. Read here, once the schema lock is held, so a
   * migration that ends while the run waits for the lock is the state the run converts towards.
   */
  entities: readonly RepairEntity[] | (() => Promise<readonly RepairEntity[]>);
  nextlyVersion: string;
  /** How long to wait for the schema lock; the lock's own wait for a command-line run when left out. */
  schemaLockWaitMs?: number;
  /** How long one try waits for a table in use; {@link TABLE_TRY_MS} when left out. */
  tableTryMs?: number;
  /**
   * The run's data-loss consent. A lossy column converts under it only where it names the column
   * as `table.column`. No consent when left out.
   */
  consent?: DataLossConsent;
  /**
   * Asks the person at the terminal whether to clear a lossy column's values, for a column the
   * consent does not name. Given only for a run that may ask, which its caller decided before
   * anything was asked; left out, a lossy column the consent does not name is skipped.
   */
  confirmClearing?: (question: ClearingQuestion) => Promise<boolean>;
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

/** This run's consent to clearing one column's values. */
interface Clearing {
  given: "flag" | "confirmed";
  /**
   * The rows a yes at the terminal was given for, by key text; null where the consent names the
   * column, which covers whatever rows the run's judgement names.
   */
  confirmed: ReadonlySet<string> | null;
  flag: string;
}

/** A difference judged again, with every row whose value its conversion would clear. */
interface Judged {
  finding: DiffersFinding;
  cleared: RowKey[];
}

/** How a MySQL conversion's steps run: its clearing first, where it clears values. */
interface StepPlan {
  /** The statements of each step after the clearing. */
  statements: readonly (readonly string[])[];
  /** 1 where the conversion's first step is its clearing, else 0. */
  offset: 0 | 1;
  /** The rows the clearing names; null where no clearing is left to run. */
  clear: RowKey[] | null;
  /** The consent the clearing runs under, for the record of the run. */
  consent: ColumnConsentFacts | null;
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
      // A run stopped by a signal gives the lock back rather than hold it until its lease ends.
      releaseOnInterrupt: true,
      ...(args.schemaLockWaitMs !== undefined
        ? { waitMs: args.schemaLockWaitMs }
        : {}),
    },
    async () => {
      // Under the lock: the definitions, the live columns and the progress rows the run decides
      // from are all read from the one schema state no other change can move.
      const entities =
        typeof args.entities === "function"
          ? await args.entities()
          : args.entities;
      return new ApplyRun({ ...args, entities }).run();
    }
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

/** Whether a finding is a difference this run converts: classed, with statements, no plugin's. */
function hasConversion(finding: ColumnFinding): finding is DiffersFinding {
  return (
    finding.kind === "differs" &&
    finding.plugin === undefined &&
    finding.conversion !== null &&
    finding.conversion.steps.length > 0
  );
}

/** Whether a finding is a difference this run converts as it is: safe. */
function convertible(finding: ColumnFinding): finding is DiffersFinding {
  return hasConversion(finding) && findingClass(finding) === "safe";
}

/** Whether a finding is a difference this run converts only under consent: lossy. */
function clearable(finding: ColumnFinding): finding is DiffersFinding {
  return hasConversion(finding) && findingClass(finding) === "lossy";
}

/** The record facts of a repair about to run. */
function repairFacts(
  finding: DiffersFinding,
  cls: ConversionClass,
  clearing: Clearing | null,
  valuesCleared = 0
): RepairFacts {
  return {
    table: finding.judged?.liveTable ?? finding.location.table,
    column: finding.judged?.liveColumn ?? finding.location.column,
    from: finding.live,
    to: finding.expected,
    class: cls,
    consent: clearing !== null,
    valuesCleared,
  };
}

/** The consent facts of a clearing that ran under `clearing`, clearing `valuesCleared` values. */
function consentRan(
  clearing: Clearing,
  valuesCleared: number
): ColumnConsentFacts {
  return {
    given: clearing.given,
    valuesCleared,
    flag: clearing.flag,
    notice: null,
  };
}

/** The consent facts of a lossy column whose values this run did not clear, and why. */
function consentWithheld(
  flag: string,
  notice: string | null
): ColumnConsentFacts {
  return { given: null, valuesCleared: 0, flag, notice };
}

/** The rows the judgement names for each reason that clears values, the bounded first keys. */
function firstCleared(finding: DiffersFinding): RowKey[] {
  return (finding.judgement?.reasons ?? [])
    .filter(reason => reason.class === "lossy")
    .flatMap(reason => reason.rows?.first ?? []);
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

/** What a run says when the rows a yes was given for are no longer the rows it would clear. */
const ROWS_CHANGED =
  "the values that would be cleared changed since the clearing was confirmed, so nothing was cleared: run again to see them";

/** One run of `--apply`, under the schema lock. */
class ApplyRun {
  private readonly adapter: DrizzleAdapter;
  private readonly dialect: SupportedDialect;
  private readonly tryMs: number;
  private readonly consent: DataLossConsent;
  private repairsTableReady = false;
  /** SQLite's one writer was held past a try: no further conversion tries this run. */
  private databaseHeld = false;

  constructor(
    private readonly args: ApplyRepairsArgs & {
      entities: readonly RepairEntity[];
    }
  ) {
    this.adapter = args.adapter;
    this.dialect = args.dialect;
    this.tryMs = args.tableTryMs ?? TABLE_TRY_MS;
    this.consent = args.consent ?? NO_CONSENT;
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
      const done = await this.resumeGuarded(progress, findings);
      records.push(repairRecord(done.finding, done.facts, "apply"));
    }
    for (const finding of notResumed(findings, unfinished)) {
      const done = await this.columnOutcome(finding);
      if (done !== null) {
        records.push(repairRecord(done.finding, done.facts, "apply"));
      }
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

  /**
   * One column of this run: converted where it is safe, or lossy under consent, otherwise reported
   * as it is. Null where the column no longer differs by the time its turn comes.
   */
  private async columnOutcome(
    finding: ColumnFinding
  ): Promise<Converted | null> {
    if (!convertible(finding) && !clearable(finding)) {
      return { finding, facts: NO_RUN_FACTS };
    }
    if (this.databaseHeld) {
      return {
        finding,
        facts: { ...NO_RUN_FACTS, lock: this.lockFacts(finding, 0, 0) },
      };
    }
    try {
      // Planned again from the table as the conversions before it in this run left it: a plan
      // read at the start could restate a table another column's conversion has since changed,
      // and on SQLite rebuild it as it first stood.
      const fresh = await this.refreshed(finding);
      if (fresh === null) return null;
      let clearing: Clearing | null = null;
      if (clearable(fresh)) {
        const decided = await this.consentFor(fresh);
        if (!("given" in decided)) {
          return {
            finding: decided.finding,
            facts: { ...NO_RUN_FACTS, ...decided.facts },
          };
        }
        clearing = decided;
      } else if (!convertible(fresh)) {
        return { finding: fresh, facts: NO_RUN_FACTS };
      }
      // Made only once a column is still to convert.
      await this.ensureRepairsTable();
      const done =
        this.dialect === "mysql"
          ? await this.convertInSteps(fresh, clearing)
          : await this.convertInTransaction(fresh, clearing);
      // A consent given stays on the record whatever the conversion's outcome, so a failed column
      // never reads as one no consent covered.
      return clearing === null || done.facts.consent !== null
        ? done
        : {
            ...done,
            facts: { ...done.facts, consent: consentRan(clearing, 0) },
          };
    } catch (error) {
      // SQLite's one writer held past its try while the record table was made: the database is
      // held, as for a conversion's own wait, so no further SQLite conversion tries this run.
      if (this.dialect === "sqlite" && waitedOutTable(error)) {
        this.databaseHeld = true;
        return {
          finding,
          facts: {
            ...NO_RUN_FACTS,
            lock: this.lockFacts(finding, 1, this.tryMs),
          },
        };
      }
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

  /**
   * Whether this run may clear a lossy column's values: the consent naming the column, or a yes
   * from the person at the terminal, asked with the count and the first rows the run's judgement
   * names now, before the column's table is closed. Otherwise the facts that say why not: its
   * consent, and, for a column this run cannot clear, its failure.
   */
  private async consentFor(finding: DiffersFinding): Promise<
    | Clearing
    | {
        finding: DiffersFinding;
        facts: Pick<ColumnRunFacts, "consent" | "failure">;
      }
  > {
    const { table, column } = finding.location;
    const verdict = consentForColumn(this.consent, table, column);
    const withheld = (on: DiffersFinding) => ({
      finding: on,
      facts: {
        consent: consentWithheld(verdict.flag, verdict.notice),
        failure: null,
      },
    });
    // A column this run cannot clear is failed before anyone is asked about it, whatever consent
    // names it: a yes could not be acted on.
    const refused = this.clearingRefusal(finding);
    if (refused !== null) {
      return {
        finding,
        facts: {
          consent: verdict.covered
            ? {
                given: "flag",
                valuesCleared: 0,
                flag: verdict.flag,
                notice: null,
              }
            : consentWithheld(verdict.flag, verdict.notice),
          failure: { reason: refused, heldStep: null },
        },
      };
    }
    if (verdict.covered) {
      return { given: "flag", confirmed: null, flag: verdict.flag };
    }
    const ask = this.args.confirmClearing;
    if (ask === undefined) return withheld(finding);
    const judged = await this.judged(this.db, finding);
    if (findingClass(judged.finding) !== "lossy") {
      // Its values changed while it was judged: nothing to ask about until a run sees them.
      return withheld(judged.finding);
    }
    const yes = await ask({
      table,
      column,
      count: judged.cleared.length,
      first: firstCleared(judged.finding),
      reasons: (judged.finding.judgement?.reasons ?? [])
        .filter(reason => reason.class === "lossy")
        .map(reason => reason.kind),
    });
    if (!yes) return withheld(judged.finding);
    return {
      given: "confirmed",
      confirmed: new Set(judged.cleared.map(rowKeyText)),
      flag: verdict.flag,
    };
  }

  /**
   * The column's difference read again, under the lock, from the live table: its state, its plan
   * and its class. Null where it no longer differs.
   */
  private async refreshed(
    finding: DiffersFinding
  ): Promise<ColumnFinding | null> {
    const { kind, slug } = finding.location;
    const entity = this.args.entities.find(
      e => e.kind === kind && e.slug === slug
    );
    if (entity === undefined) return finding;
    const now = await findColumnDifferences({
      db: this.db,
      dialect: this.dialect,
      entities: [entity],
    });
    return (
      now.find(
        f =>
          f.kind === "differs" &&
          isAt(f, finding.location.table, finding.location.column)
      ) ?? null
    );
  }

  private async ensureRepairsTable(): Promise<void> {
    if (this.repairsTableReady) return;
    await ensureColumnRepairsTable(this.adapter, this.dialect);
    this.repairsTableReady = true;
  }

  /**
   * The finding judged again from the rows `db` reads now, with every row whose value its
   * conversion would clear: past the bound the report names, from the same pass that classes it.
   */
  private async judged(db: unknown, finding: DiffersFinding): Promise<Judged> {
    if (finding.judged === undefined) {
      throw NextlyError.internal({
        logContext: {
          reason: "a difference to convert carries no judgement subject",
          table: finding.location.table,
          column: finding.location.column,
        },
      });
    }
    const cleared: RowKey[] = [];
    // A value gives at most one reason that clears it, so each row is noted here once.
    const judgement = await classifyDifference(
      db,
      this.dialect,
      finding.judged,
      {
        noteRow: (kind, key) => {
          if (reasonClass(kind) === "lossy") cleared.push(key);
        },
      }
    );
    return { finding: { ...finding, judgement }, cleared };
  }

  /**
   * Whether the column, judged again where it is about to change, still converts under what this
   * run has: a safe column always; a lossy one only under consent, and, under a yes at the
   * terminal, only where every row it would clear is one the yes was given for. Otherwise the
   * outcome it ends with, unchanged.
   */
  private stillConverts(
    judged: Judged,
    clearing: Clearing | null
  ): Converted | null {
    const now = judged.finding;
    const cls = findingClass(now);
    if (cls === "safe") return null;
    if (cls !== "lossy" || clearing === null) {
      return { finding: now, facts: NO_RUN_FACTS };
    }
    const refused = this.clearingRefusal(now);
    if (refused !== null) {
      return {
        finding: now,
        facts: {
          ...NO_RUN_FACTS,
          failure: { reason: refused, heldStep: null },
          consent: consentRan(clearing, 0),
        },
      };
    }
    const confirmed = clearing.confirmed;
    if (
      confirmed !== null &&
      judged.cleared.some(key => !confirmed.has(rowKeyText(key)))
    ) {
      return {
        finding: now,
        facts: {
          ...NO_RUN_FACTS,
          consent: consentWithheld(clearing.flag, ROWS_CHANGED),
        },
      };
    }
    return null;
  }

  private async step(finding: DiffersFinding, step: number): Promise<void> {
    await this.args.beforeStep?.({
      table: finding.location.table,
      column: finding.location.column,
      step,
    });
  }

  /**
   * PostgreSQL and SQLite: the judgement, the clearing, the conversion and its record in one
   * transaction, which any failure rolls back whole.
   */
  private async convertInTransaction(
    finding: DiffersFinding,
    clearing: Clearing | null
  ): Promise<Converted> {
    const started = Date.now();
    const liveTable = finding.judged?.liveTable ?? finding.location.table;
    const table = quoteIdent(liveTable, this.dialect);
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
        const judged = await this.judged(tx.db, finding);
        const stopped = this.stillConverts(judged, clearing);
        if (stopped !== null) return stopped;
        const now = judged.finding;
        const cls = findingClass(now) ?? "safe";
        const cleared = cls === "lossy" ? judged.cleared : [];
        const clear = clearingStatements({
          table: liveTable,
          column: now.judged?.liveColumn ?? now.location.column,
          keyedBy: now.judged?.keyedBy ?? "none",
          keys: cleared,
        });
        const liveColumn = now.judged?.liveColumn ?? now.location.column;
        if (this.dialect === "postgresql" && clear.length > 0) {
          // PostgreSQL's cast refuses a value the new type cannot hold, so the named values are
          // cleared before it runs; a column that does not allow a null yet (its field allows
          // one, or the clearing would be blocked) drops NOT NULL first, as its conversion would.
          if (!now.live.nullable) {
            await runSql(
              tx.db,
              this.dialect,
              sql`ALTER TABLE ${sql.identifier(liveTable)} ALTER COLUMN ${sql.identifier(liveColumn)} DROP NOT NULL`
            );
          }
          for (const statement of clear) {
            await runSql(tx.db, this.dialect, statement);
          }
        }
        for (const [index, group] of (now.conversion?.steps ?? []).entries()) {
          await this.step(now, index);
          for (const statement of group) await tx.execute(statement);
        }
        if (this.dialect === "sqlite") {
          // SQLite's rebuild copies each value as the new column keeps it, so the named values
          // are cleared in the rebuilt table, before the transaction commits.
          for (const statement of clear) {
            await runSql(tx.db, this.dialect, statement);
          }
        }
        const steps = now.conversion?.steps.length ?? 0;
        await insertRepair(
          tx.db,
          this.dialect,
          repairFacts(now, cls, clearing, cleared.length),
          { state: "converted", step: steps, steps }
        );
        return {
          finding: now,
          facts: {
            ...NO_RUN_FACTS,
            converted: true,
            consent:
              clearing === null ? null : consentRan(clearing, cleared.length),
          },
        };
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
    // Putting the wait back is best effort: the conversion has already committed or rolled back,
    // and a failure here must not turn its outcome into another.
    return () =>
      this.adapter
        .executeQuery(
          `PRAGMA busy_timeout = ${String(Number.isFinite(previous) ? previous : 0)}`
        )
        .then(
          () => undefined,
          () => undefined
        );
  }

  /**
   * MySQL: judge again, record the progress, then run each step, moving the record on after each
   * commit. A lossy column clears its named values first, in a step of its own.
   */
  private async convertInSteps(
    finding: DiffersFinding,
    clearing: Clearing | null
  ): Promise<Converted> {
    const judged = await this.judged(this.db, finding);
    const stopped = this.stillConverts(judged, clearing);
    if (stopped !== null) return stopped;
    const now = judged.finding;
    const cls = findingClass(now) ?? "safe";
    const statements = now.conversion?.steps ?? [];
    const clears = cls === "lossy";
    const offset = clears ? 1 : 0;
    const rowId = await insertRepair(
      this.db,
      this.dialect,
      repairFacts(now, cls, clearing),
      { state: "in-progress", step: 0, steps: offset + statements.length }
    );
    return this.runSteps(now, rowId, 0, {
      statements,
      offset,
      clear: clears ? judged.cleared : null,
      consent: clearing === null ? null : consentRan(clearing, 0),
    });
  }

  /**
   * Why this run cannot clear a lossy column's values, or null where it can: the one check, made
   * before anyone is asked about the column and again where it is about to change. The rows to
   * clear are named by key, so a table keyed by neither its id nor its parent and locale has none
   * to name. MySQL's clearing reads which named rows still hold a value it does not take as JSON,
   * so there it serves a column becoming JSON, converted by one statement, and nothing else. A
   * column refused is failed as it was, rather than cleared by rows that could be the wrong ones.
   */
  private clearingRefusal(finding: DiffersFinding): string | null {
    if ((finding.judged?.keyedBy ?? "none") === "none") {
      return "the table is keyed by neither its id nor its parent and locale, so the values to clear cannot be named by row; nothing was cleared";
    }
    if (this.dialect !== "mysql") return null;
    const kinds = (finding.judgement?.reasons ?? [])
      .filter(reason => reason.class === "lossy")
      .map(reason => reason.kind);
    const statements = finding.conversion?.steps.length ?? 0;
    if (statements === 1 && kinds.every(kind => kind === "not-json")) {
      return null;
    }
    return "MySQL clears values in a step of its own only for a column becoming JSON in one statement; nothing was cleared";
  }

  /**
   * MySQL: clear the named rows that still hold a value it does not take as JSON, and move the
   * progress record past the clearing with their count, in one transaction on `session`. Returns
   * how many values were cleared.
   */
  private async clearOnSession(
    session: StatementSession,
    finding: DiffersFinding,
    rowId: string,
    keys: readonly RowKey[],
    step: number
  ): Promise<number> {
    const compiler = new MySqlDialect();
    const run = async <R>(statement: SQL): Promise<R[]> => {
      const compiled = compiler.sqlToQuery(statement);
      return session.execute<R>(compiled.sql, compiled.params as SqlParam[]);
    };
    const subject = {
      table: finding.judged?.liveTable ?? finding.location.table,
      column: finding.judged?.liveColumn ?? finding.location.column,
      keyedBy: finding.judged?.keyedBy ?? ("none" as const),
    };
    await run(sql`START TRANSACTION`);
    try {
      const still: RowKey[] = [];
      for (const query of stillNotJsonQueries({ ...subject, keys })) {
        const rows = await run<{ k1?: unknown; k2?: unknown }>(query);
        still.push(...rows.map(row => rowKeyOf(row, subject.keyedBy)));
      }
      for (const statement of clearingStatements({ ...subject, keys: still })) {
        await run(statement);
      }
      await run(clearedStepStatement(rowId, step, still.length));
      await run(sql`COMMIT`);
      return still.length;
    } catch (error) {
      // Undone whole: no value cleared and the record where it was. Best effort, as the
      // connection is closed after the session either way, which ends the transaction too.
      await run(sql`ROLLBACK`).catch(() => undefined);
      throw error;
    }
  }

  /** Run `plan`'s steps from `from` on one strict-mode session, recording each committed step. */
  private async runSteps(
    finding: DiffersFinding,
    rowId: string,
    from: number,
    plan: StepPlan
  ): Promise<Converted> {
    const started = Date.now();
    const total = plan.offset + plan.statements.length;
    const clearing = plan.offset === 1;
    let reached = from;
    let cleared = 0;
    try {
      await this.adapter.withSession(
        async session => {
          // One bounded try for the table, for every statement of this session: the metadata
          // lock a schema statement waits for, and the row locks the list conversion's rewrite
          // and a clearing wait for.
          const seconds = String(Math.max(1, Math.ceil(this.tryMs / 1000)));
          await session.execute(`SET SESSION lock_wait_timeout = ${seconds}`);
          await session.execute(
            `SET SESSION innodb_lock_wait_timeout = ${seconds}`
          );
          for (let index = from; index < total; index++) {
            await this.step(finding, index);
            if (index < plan.offset) {
              // The clearing commits with its record, so the record cannot fall behind it.
              cleared = await this.clearOnSession(
                session,
                finding,
                rowId,
                plan.clear ?? [],
                index + 1
              );
              reached = index + 1;
              continue;
            }
            for (const statement of plan.statements[index - plan.offset]) {
              await session.execute(statement);
            }
            reached = index + 1;
            await recordStep(this.db, this.dialect, rowId, reached, total);
          }
        },
        { strictSqlMode: true }
      );
      return {
        finding,
        facts: {
          ...NO_RUN_FACTS,
          converted: true,
          consent:
            plan.consent === null
              ? null
              : { ...plan.consent, valuesCleared: cleared },
        },
      };
    } catch (error) {
      const stopped = await this.stoppedAt(
        finding,
        rowId,
        { from, reached, total, clearing },
        error,
        started
      );
      return plan.consent === null
        ? stopped
        : {
            ...stopped,
            facts: {
              ...stopped.facts,
              consent: { ...plan.consent, valuesCleared: cleared },
            },
          };
    }
  }

  /** What a conversion that stopped at step `reached` of `total` leaves, and its outcome. */
  private async stoppedAt(
    finding: DiffersFinding,
    rowId: string,
    at: { from: number; reached: number; total: number; clearing: boolean },
    error: unknown,
    started: number
  ): Promise<Converted> {
    const { from, reached, total, clearing } = at;
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
    const held = stepName(reached, total, clearing);
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
   * `resume`, with anything that stops it failing that column alone: the run goes on with the
   * others and still reports, and the column and its record are left as they are.
   */
  private async resumeGuarded(
    progress: RecordedProgress,
    findings: readonly ColumnFinding[]
  ): Promise<Converted> {
    try {
      return await this.resume(progress, findings);
    } catch (error) {
      return {
        finding: progressFinding(progress, findings, this.args.entities, null),
        facts: {
          ...NO_RUN_FACTS,
          progress: {
            recordedStep: progressStepName(progress, progress.step),
            liveStep: null,
          },
          failure: { reason: reasonOf(error), heldStep: null },
        },
      };
    }
  }

  /**
   * Finish a conversion an earlier run left at a recorded step, from the step its live column has
   * reached. A clearing still to run needs this run's own consent naming the column, and clears
   * only the rows this run's judgement names; without it the column stays at its step.
   */
  private async resume(
    progress: RecordedProgress,
    findings: readonly ColumnFinding[]
  ): Promise<Converted> {
    const live = await readLiveState(this.db, this.dialect, progress);
    const finding = progressFinding(
      progress,
      findings,
      this.args.entities,
      live
    );
    const reached = await liveStepOf(this.db, this.dialect, progress, live);
    const recordedStep = progressStepName(progress, progress.step);
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
      // The column already holds its field's definition: only the record is behind. A list
      // conversion stopped between its retype and the normalising that follows it can still
      // hold a scalar written before the retype, so that is finished first.
      if (progress.steps === LIST_CONVERSION_STEPS && !clearsFirst(progress)) {
        await this.adapter.withSession(
          async session => {
            await session.execute(
              mysqlReferenceListNormalise(progress.table, progress.column)
            );
          },
          { strictSqlMode: true }
        );
      }
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
        progress: {
          recordedStep,
          liveStep: progressStepName(progress, reached),
        },
      },
    };
    if (finding.judged === undefined || finding.conversion === null)
      return interrupted;
    const offset = clearsFirst(progress) ? 1 : 0;
    // The clearing still to run is asked about, or found covered, before the column is judged for
    // it, so the rows it clears are the ones judged after any question was answered.
    let clearing: Clearing | null = null;
    if (offset === 1 && reached === 0) {
      const decided = await this.consentFor(finding);
      if (!("given" in decided)) {
        return {
          finding: decided.finding,
          facts: { ...interrupted.facts, ...decided.facts },
        };
      }
      clearing = decided;
    }
    const judged = await this.judged(this.db, finding);
    const now = judged.finding;
    const statements = now.conversion?.steps ?? [];
    const cls = findingClass(now);
    // The conversion the column needs now must be the one its record began, towards the same
    // target; anything else is left for its owner, never run in its place.
    const sameConversion =
      offset + statements.length === progress.steps &&
      compareColumn(now.expected, progress.to) === null;
    const clearingLeft = offset === 1 && reached === 0;
    if (!sameConversion || cls !== (clearingLeft ? "lossy" : "safe")) {
      return { ...interrupted, finding: now };
    }
    if (clearing !== null) {
      const stopped = this.stillConverts(judged, clearing);
      if (stopped !== null) {
        return {
          finding: now,
          facts: {
            ...interrupted.facts,
            consent: stopped.facts.consent,
            failure: stopped.facts.failure,
          },
        };
      }
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
    return this.runSteps(now, progress.id, reached, {
      statements,
      offset: offset === 1 ? 1 : 0,
      clear: clearingLeft ? judged.cleared : null,
      consent: clearing === null ? null : consentRan(clearing, 0),
    });
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
