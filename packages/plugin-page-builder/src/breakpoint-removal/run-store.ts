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
import { and, eq, isNotNull } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import type { RunPhase } from "../host-rewrite/fence";
import { markPending } from "../host-rewrite/progress";
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
   * A document holding a removed breakpoint's value was written while its
   * run was open: mark it pending and send the run back to its converting
   * walk, in one transaction. Does nothing once the run is done.
   */
  requeue(runId: string, documentKey: string): Promise<void>;
  /** Remove a run that wrote nothing, with its progress, closing it. */
  abandon(runId: string): Promise<void>;
}

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
        throw NextlyError.conflict({
          reason: "state",
          message: ANOTHER_REMOVAL_RUNNING,
          logContext: { reason: "breakpoint-removal-already-open" },
        });
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
    requeue: async (runId, documentKey) =>
      db.transaction(async tx => {
        const t = tx.table(breakpointRemovals);
        const open = both(eq(t.id, runId), isNotNull(t.openKey));
        if (
          (await tx.select(breakpointRemovals).where(open).first()) === null
        ) {
          return;
        }
        // The pending row and the run's phase land together: a pending row
        // with the run left in its final walk would never be visited again.
        await markPending(tx, runId, documentKey);
        await tx
          .update(breakpointRemovals, { phase: "converting", cursor: null })
          .where(open);
      }),
    abandon: async runId =>
      db.transaction(async tx => {
        const h = tx.table(componentDeletionHosts);
        await tx.delete(componentDeletionHosts).where(eq(h.deletionId, runId));
        const t = tx.table(breakpointRemovals);
        await tx.delete(breakpointRemovals).where(eq(t.id, runId));
      }),
  };
}
