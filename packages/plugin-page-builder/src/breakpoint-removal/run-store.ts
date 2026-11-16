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
  /**
   * The breakpoint ids the run still claims: those it removed that the site
   * has not defined again since it was done. Every check of what a run holds,
   * strips or re-queues reads these.
   */
  readonly removedIds: readonly string[];
  /**
   * The ids it removed that the site defined again after it was done: no
   * longer its claim, so a later removal of the same id, confirmed or not, is
   * never stripped with this run's set.
   */
  readonly readdedIds: readonly string[];
  /**
   * The breakpoint set the site stored before the removal, as stored: `null`
   * where it stored none and the configured set applied.
   */
  readonly before: unknown;
  /**
   * The breakpoints the stylesheet was emitted under when the removal began:
   * `before` over the configured defaults as they were then, kept so a run
   * carried on after the defaults changed carries hides under the cascade it
   * began with. Read strictly by its reader (`removalOf`).
   */
  readonly beforeEmitted: unknown;
  /** Who saved the removal: `user:<id>` or `api-key:<id>`. */
  readonly startedBy: string;
  /** Whether the run is still open: not yet walked to the end. */
  readonly open: boolean;
  /**
   * Opened by a save that has not stored its set yet: open, holding the one
   * slot, and walked by nobody until that save publishes it (`publish`).
   */
  readonly preparing: boolean;
  /**
   * Set on a run that puts a removal back rather than making one: the id of
   * the removal it undoes. `null` for a removal.
   */
  readonly undoes: string | null;
}

/** The removal runs' table, through the plugin's database surface. */
export interface RemovalRunStore extends RunStore {
  /**
   * Open a run. Refused with a conflict while another is open: one removal
   * at a time, whoever started it.
   */
  open(
    removedIds: readonly string[],
    before: { readonly stored: unknown; readonly emitted: unknown },
    startedBy: string,
    /** For a run that undoes a removal: that removal's id. */
    undoes?: string
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
  /**
   * Which of `runIds` recorded this document as left: each such run holds its
   * ids until it walks the document again.
   */
  leftWith(
    documentKey: string,
    runIds: readonly string[]
  ): Promise<ReadonlySet<string>>;
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
  /**
   * The site defines `ids` again: every done run claiming one gives the
   * claim up (`readdedIds`). An open run is never changed here; a set
   * defining an id an open run claims is refused before it is stored.
   */
  retire(
    ids: readonly string[],
    /** Only this run gives them up, rather than every run claiming them. */
    only?: string
  ): Promise<void>;
  /**
   * The save that opened a run has stored its set: the run goes on its
   * converting walk, where the walk starts. Nothing for a run past preparing.
   */
  publish(runId: string): Promise<void>;
  /**
   * Documents done runs left for `reason`, with the run each waits on, at
   * most `limit` of them.
   */
  leftFor(
    reason: string,
    limit: number
  ): Promise<{ runId: string; documentKey: string }[]>;
}

/**
 * Every breakpoint id a run removed: those it still claims and those the site
 * defined again since. What undoing it defines again, and puts back under.
 */
export function removedEver(
  run: Pick<BreakpointRun, "removedIds" | "readdedIds">
): ReadonlySet<string> {
  return new Set([...run.removedIds, ...run.readdedIds]);
}

/** A run that still holds what it removed, and why. */
export interface HoldingRun {
  readonly run: BreakpointRun;
  /** Why each document it left was left; empty for the open run. */
  readonly leftReasons: readonly string[];
}

/** How many times a retirement is tried against a row another save moved. */
const RETIRE_ATTEMPTS = 5;

/** What a save is told when old removals could not give up an id it re-adds. */
const RETIRE_LOST =
  "The site's breakpoints are being changed by someone else right now. Try saving again.";

/** Why a document written back with removed values waits on a done run. */
export const WRITTEN_BACK = "written-back";

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/**
 * The phase a run is opened in, before its save has stored its set. Not one
 * of the walk's phases: no walk moves a run out of it, so none starts on a
 * run whose set may yet be refused.
 */
const PREPARING = "preparing";

/** A stored phase, read strictly: anything else is the converting walk. */
function phaseOf(value: string): RunPhase {
  return value === "final" || value === "done" ? value : "converting";
}

/** The `removed_ids` column's record: every id removed, and those re-added. */
interface StoredIds {
  readonly ids: readonly string[];
  readonly readded: readonly string[];
}

/** A list of strings, or `undefined`. */
function stringsOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(id => typeof id === "string")
    ? (value as string[])
    : undefined;
}

/**
 * The stored ids, read strictly. A record that cannot be read is refused
 * rather than read as empty: an empty list would strip nothing and report the
 * run finished. An undo's run removes nothing, so its list is empty
 * (`undoing`).
 */
function storedIdsOf(text: string, runId: string, undoing: boolean): StoredIds {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const ids = stringsOf(record.ids);
  const readded = stringsOf(record.readded);
  if (
    ids !== undefined &&
    (ids.length > 0 || undoing) &&
    readded !== undefined
  ) {
    return { ids, readded };
  }
  throw NextlyError.internal({
    logContext: { reason: "breakpoint-removal-unreadable-ids", runId },
  });
}

/**
 * The sets before, decoded from the `before` column's `{ stored, emitted }`;
 * text that is not JSON, or not that record, reads as none.
 */
function beforeOf(text: string): { stored: unknown; emitted: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { stored: null, emitted: null };
  }
  const record = parsed as Record<string, unknown>;
  return { stored: record.stored ?? null, emitted: record.emitted ?? null };
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
  undoes?: string | null;
}): BreakpointRun {
  const before = beforeOf(row.before);
  const stored = storedIdsOf(
    row.removedIds,
    row.id,
    row.undoes !== null && row.undoes !== undefined
  );
  const readded = new Set(stored.readded);
  return {
    id: row.id,
    removedIds: stored.ids.filter(id => !readded.has(id)),
    readdedIds: stored.readded,
    before: before.stored,
    beforeEmitted: before.emitted,
    startedBy: row.startedBy,
    phase: phaseOf(row.phase),
    cursor: row.cursor,
    open: row.openKey !== null,
    preparing: row.phase === PREPARING,
    undoes: row.undoes ?? null,
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
    open: async (removedIds, before, startedBy, undoes) => {
      try {
        const row = await db.transaction(tx =>
          tx.insertReturning(breakpointRemovals, {
            removedIds: JSON.stringify({
              ids: removedIds,
              readded: [],
            } satisfies StoredIds),
            before: JSON.stringify({
              stored: before.stored ?? null,
              emitted: before.emitted ?? null,
            }),
            startedBy,
            phase: PREPARING,
            openKey: OPEN,
            undoes: undoes ?? null,
          })
        );
        return runOf(row);
      } catch (error) {
        // The unique key refused a second open run.
        if (!isUniqueViolation(dialect, error)) throw error;
        throw anotherRunning();
      }
    },
    runById: oneRun,
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
          // A run still being prepared keeps its phase: it is walked from
          // the start once published, and the pending row waits for it.
          await tx
            .update(breakpointRemovals, { phase: "converting", cursor: null })
            .where(
              both(
                both(eq(t.id, runId), isNotNull(t.openKey)),
                inArray(t.phase, ["converting", "final"])
              )
            );
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
    retire: async (ids, only) => {
      if (ids.length === 0) return;
      const asked = new Set(ids);
      const t = columns();
      // Every run, open ones included: a run a late write reopened after the
      // save read the runs would otherwise keep its claim. Giving it up is
      // safe for an open run too, since a walk strips only the ids the site
      // does not define, and these are about to be defined.
      const rows = await db.select(breakpointRemovals).all();
      for (const first of rows.filter(
        row => only === undefined || row.id === only
      )) {
        let row: typeof first | null = first;
        for (let attempt = 1; row !== null; attempt += 1) {
          const stored = storedIdsOf(
            row.removedIds,
            row.id,
            row.undoes !== null && row.undoes !== undefined
          );
          const readded = new Set(stored.readded);
          const fresh = stored.ids.filter(
            id => asked.has(id) && !readded.has(id)
          );
          if (fresh.length === 0) break;
          // Conditional on the record as read: two saves re-adding at once
          // cannot drop each other's ids. A lost race reads the row again and
          // tries again; still lost, the save is refused rather than stored
          // with the claim in place.
          const moved = await db
            .update(breakpointRemovals, {
              removedIds: JSON.stringify({
                ids: stored.ids,
                readded: [...stored.readded, ...fresh],
              } satisfies StoredIds),
            })
            .where(both(eq(t.id, row.id), eq(t.removedIds, row.removedIds)));
          if (moved > 0) break;
          if (attempt >= RETIRE_ATTEMPTS) {
            throw NextlyError.conflict({
              reason: "state",
              message: RETIRE_LOST,
              logContext: { reason: "breakpoint-retire-lost", runId: row.id },
            });
          }
          row = await db
            .select(breakpointRemovals)
            .where(eq(t.id, row.id))
            .first();
        }
      }
    },
    publish: async runId => {
      const t = db.table(breakpointRemovals);
      await db
        .update(breakpointRemovals, { phase: "converting", cursor: null })
        .where(both(eq(t.id, runId), eq(t.phase, PREPARING)));
    },
    leftFor: async (reason, limit) => {
      const h = db.table(componentDeletionHosts);
      const done = (await runs()).filter(run => !run.open).map(run => run.id);
      if (done.length === 0) return [];
      const where = and(
        inArray(h.deletionId, done),
        eq(h.state, "left"),
        eq(h.reason, reason)
      );
      if (where === undefined) return [];
      const rows = await db
        .select(componentDeletionHosts)
        .where(where)
        .limit(limit)
        .all();
      return rows.map(row => ({
        runId: row.deletionId,
        documentKey: row.hostKey,
      }));
    },
    leftWith: async (documentKey, runIds) => {
      if (runIds.length === 0) return new Set<string>();
      const h = db.table(componentDeletionHosts);
      // The unique (run, document) index answers this per run named.
      const where = and(
        inArray(h.deletionId, [...runIds]),
        eq(h.hostKey, documentKey),
        eq(h.state, "left")
      );
      if (where === undefined) return new Set<string>();
      const rows = await db.select(componentDeletionHosts).where(where).all();
      return new Set(rows.map(row => row.deletionId));
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

  /** One run by its id; `null` when there is none. */
  async function oneRun(runId: string): Promise<BreakpointRun | null> {
    const row = await db
      .select(breakpointRemovals)
      .where(eq(columns().id, runId))
      .first();
    return row === null ? null : runOf(row);
  }

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
