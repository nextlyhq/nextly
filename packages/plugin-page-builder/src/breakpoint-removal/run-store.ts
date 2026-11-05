/**
 * The runs that strip a removed breakpoint's values from the site, in the
 * plugin's own `breakpoint_removals` table.
 *
 * Opening a run inserts its row with `openKey` set, and that insert is what
 * keeps a second removal out: the column is unique, so while one run is open
 * another insert is refused, and the person saving is told to wait. A run is
 * walked like a component's (`host-rewrite/rewrite`), through the narrowed
 * {@link RunStore}, and its progress is kept in the same progress table, under
 * its own id. Reaching `done` clears `openKey`, which closes the run and lets
 * the next removal open; the row stays, as the record of what was removed.
 *
 * @module breakpoint-removal/run-store
 * @experimental
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, eq, inArray, isNotNull } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import type { RunPhase } from "../host-rewrite/fence";
import { leftToPending, markLeft, markPending } from "../host-rewrite/progress";
import type { RunStore, WalkedRun } from "../host-rewrite/rewrite";
import { breakpointRemovals, componentDeletionHosts } from "../schema/tables";

/** The value `openKey` holds while a run is open: one per site. */
const OPEN = "site";

/** What a second removal, saved while one is open, is told. */
const ANOTHER_REMOVAL_RUNNING =
  "Another breakpoint removal is still running. Try again when it has finished.";

/** One removal, as its row stores it. */
export interface BreakpointRun extends WalkedRun {
  /** The breakpoint ids removed. */
  readonly removedIds: readonly string[];
  /**
   * The breakpoint set the site stored before the removal, as stored: `null`
   * where it stored none and the configured set applied.
   */
  readonly before: unknown;
  /** Who saved the removal: `user:<id>` or `api-key:<id>`. */
  readonly startedBy: string;
  /** Whether the run is still open: not yet walked to the end. */
  readonly open: boolean;
}

/** The removal runs' table, through the plugin's database surface. */
export interface RemovalRunStore extends RunStore {
  /**
   * Open a run. Refused with a conflict while another is open: one removal
   * at a time, whoever started it.
   */
  open(
    removedIds: readonly string[],
    before: unknown,
    startedBy: string
  ): Promise<BreakpointRun>;
  /** One run by its id, open or done; `null` when there is none. */
  runById(runId: string): Promise<BreakpointRun | null>;
  /** The open run, or `null` when none is. */
  openRun(): Promise<BreakpointRun | null>;
  /**
   * A document was written holding values under breakpoints this run removed,
   * which the site does not define now: send it back to be stripped, deciding
   * on the run as it is at that moment, in one transaction. An open run marks
   * it pending and goes back to its converting walk (`requeued`). A done run
   * is opened again for it, the same way (`reopened`), unless another run
   * holds the one open slot; then the document is recorded as left on this
   * run (`left`), which keeps the run holding its ids until it is carried on.
   * `none` when there is no such run.
   */
  requeueDocument(
    runId: string,
    documentKey: string
  ): Promise<"requeued" | "reopened" | "left" | "none">;
  /** Remove a run that wrote nothing, with its progress, closing it. */
  abandon(runId: string): Promise<void>;
  /** Every run, open or done: the record of every removal. */
  runs(): Promise<BreakpointRun[]>;
  /**
   * The runs still holding the breakpoints they removed: the open one, and
   * each done one with documents it left, with why it left them. While a run
   * holds an id, some document may still keep values under it.
   */
  holding(): Promise<HoldingRun[]>;
  /**
   * Open a done run again to retry the documents it left: they are marked
   * pending and the run goes back to its converting walk, in one transaction.
   * Answers false, changing nothing, when it left none; refused with a
   * conflict while another run is open.
   */
  reopen(runId: string): Promise<boolean>;
}

/** A run that still holds what it removed, and why. */
export interface HoldingRun {
  readonly run: BreakpointRun;
  /** Why each document it left was left; empty for the open run. */
  readonly leftReasons: readonly string[];
}

/** Why a document written back with removed values waits on a done run. */
export const WRITTEN_BACK = "written-back";

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** A stored phase, read strictly: anything else is the converting walk. */
function phaseOf(value: string): RunPhase {
  return value === "final" || value === "done" ? value : "converting";
}

/**
 * The stored ids, read strictly. A list that cannot be read is refused rather
 * than read as empty: an empty list would strip nothing and report the run
 * finished.
 */
function removedIdsOf(text: string, runId: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  if (Array.isArray(parsed) && parsed.every(id => typeof id === "string")) {
    return parsed as string[];
  }
  throw NextlyError.internal({
    logContext: { reason: "breakpoint-removal-unreadable-ids", runId },
  });
}

/** The stored set before, decoded; text that is not JSON reads as none. */
function beforeOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A run row as this module hands it out. */
function runOf(row: {
  id: string;
  removedIds: string;
  before: string;
  startedBy: string;
  phase: string;
  cursor: string | null;
  openKey: string | null;
}): BreakpointRun {
  return {
    id: row.id,
    removedIds: removedIdsOf(row.removedIds, row.id),
    before: beforeOf(row.before),
    startedBy: row.startedBy,
    phase: phaseOf(row.phase),
    cursor: row.cursor,
    open: row.openKey !== null,
  };
}

/** Both conditions, as one. `and` is typed as possibly empty; two never are. */
function both(
  first: NonNullable<ReturnType<typeof and>>,
  second: NonNullable<ReturnType<typeof and>>
): NonNullable<ReturnType<typeof and>> {
  return and(first, second) ?? first;
}

/** The table operations a run is moved through: `ctx.db`, or a transaction. */
type RunHandle = Pick<PluginTransaction, "table" | "update">;

/**
 * Put a done run back on its converting walk, holding the one open slot
 * again: a unique violation when another run holds it.
 */
async function reopenDone(handle: RunHandle, runId: string): Promise<void> {
  const t = handle.table(breakpointRemovals);
  await handle
    .update(breakpointRemovals, {
      phase: "converting",
      cursor: null,
      openKey: OPEN,
    })
    .where(both(eq(t.id, runId), eq(t.phase, "done")));
}

/** The refusal for a run opened while another is open. */
function anotherRunning(): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: ANOTHER_REMOVAL_RUNNING,
    logContext: { reason: "breakpoint-removal-already-open" },
  });
}

/** The removal run store over the plugin's own `ctx.db`. */
export function removalRunStore(
  db: Pick<
    PluginDatabase,
    "transaction" | "select" | "table" | "update" | "insert" | "delete"
  >,
  dialect: Dialect
): RemovalRunStore {
  // Resolved per call, as the fence's are.
  const columns = () => db.table(breakpointRemovals);
  return {
    open: async (removedIds, before, startedBy) => {
      try {
        const row = await db.transaction(tx =>
          tx.insertReturning(breakpointRemovals, {
            removedIds: JSON.stringify(removedIds),
            before: JSON.stringify(before ?? null),
            startedBy,
            phase: "converting",
            openKey: OPEN,
          })
        );
        return runOf(row);
      } catch (error) {
        // The unique key refused a second open run.
        if (!isUniqueViolation(dialect, error)) throw error;
        throw anotherRunning();
      }
    },
    runById: async runId => {
      const row = await db
        .select(breakpointRemovals)
        .where(eq(columns().id, runId))
        .first();
      return row === null ? null : runOf(row);
    },
    openRun: async () => {
      const row = await db
        .select(breakpointRemovals)
        .where(eq(columns().openKey, OPEN))
        .first();
      return row === null ? null : runOf(row);
    },
    advance: async (runId, from, to, cursor) => {
      // Reaching `done` closes the run in the same statement, so a run is
      // never done and still holding the one open slot. Every move writes a
      // phase or a cursor it did not hold before, so the count is the rows
      // matched on MySQL too, which counts changed rows.
      const r = columns();
      const moved = await db
        .update(breakpointRemovals, {
          phase: to,
          cursor,
          ...(to === "done" ? { openKey: null } : {}),
        })
        .where(both(eq(r.id, runId), eq(r.phase, from)));
      return moved > 0;
    },
    requeueDocument: async (runId, documentKey) => {
      try {
        return await db.transaction(async tx => {
          const t = tx.table(breakpointRemovals);
          // The update comes first, and takes the run's row while it is open:
          // the walk's own move to `done` then waits for this transaction and
          // finds the run back on its converting walk, so the pending row
          // below is never written for a run that has just closed. A run
          // already done matches nothing here and is opened again below.
          await tx
            .update(breakpointRemovals, { phase: "converting", cursor: null })
            .where(both(eq(t.id, runId), isNotNull(t.openKey)));
          const run = await tx
            .select(breakpointRemovals)
            .where(eq(t.id, runId))
            .first();
          if (run === null) return "none";
          if (run.openKey !== null) {
            await markPending(tx, runId, documentKey);
            return "requeued";
          }
          // Asked first rather than left to the unique index: this runs from
          // a hook, whose writes may join the writer's own transaction, and on
          // MySQL a refused statement there fails that whole transaction. The
          // index still decides a race between this read and the reopen.
          const holder = await tx
            .select(breakpointRemovals)
            .where(eq(t.openKey, OPEN))
            .first();
          if (holder !== null) {
            await markLeft(tx, runId, documentKey, WRITTEN_BACK);
            return "left";
          }
          await reopenDone(tx, runId);
          await markPending(tx, runId, documentKey);
          return "reopened";
        });
      } catch (error) {
        // Another run took the open slot between the read and the reopen:
        // the document waits on this run, recorded as left, until it is
        // carried on.
        if (!isUniqueViolation(dialect, error)) throw error;
        await markLeft(db, runId, documentKey, WRITTEN_BACK);
        return "left";
      }
    },
    abandon: async runId =>
      db.transaction(async tx => {
        const h = tx.table(componentDeletionHosts);
        await tx.delete(componentDeletionHosts).where(eq(h.deletionId, runId));
        const t = tx.table(breakpointRemovals);
        await tx.delete(breakpointRemovals).where(eq(t.id, runId));
      }),
    runs,
    holding: async () => {
      const all = await runs();
      const reasons = await leftReasonsOf(all.filter(run => !run.open));
      return all
        .filter(run => run.open || reasons.has(run.id))
        .map(run => ({ run, leftReasons: reasons.get(run.id) ?? [] }));
    },
    reopen: async runId => {
      try {
        return await db.transaction(async tx => {
          if (!(await leftToPending(tx, runId))) return false;
          await reopenDone(tx, runId);
          return true;
        });
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
        throw anotherRunning();
      }
    },
  };

  /** Every run. One row per removal ever saved, so a short table. */
  async function runs(): Promise<BreakpointRun[]> {
    const rows = await db.select(breakpointRemovals).all();
    return rows.map(runOf);
  }

  /** Why each of these runs left each document it left, by run id. */
  async function leftReasonsOf(
    done: readonly BreakpointRun[]
  ): Promise<Map<string, string[]>> {
    const reasons = new Map<string, string[]>();
    if (done.length === 0) return reasons;
    const h = db.table(componentDeletionHosts);
    const where = and(
      inArray(
        h.deletionId,
        done.map(run => run.id)
      ),
      eq(h.state, "left")
    );
    if (where === undefined) return reasons;
    const rows = await db.select(componentDeletionHosts).where(where).all();
    for (const row of rows) {
      const list = reasons.get(row.deletionId) ?? [];
      list.push(row.reason ?? "");
      reasons.set(row.deletionId, list);
    }
    return reasons;
  }
}
