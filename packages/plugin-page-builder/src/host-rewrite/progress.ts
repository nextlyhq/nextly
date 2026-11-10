/**
 * What a run has done to each host document, in the plugin's own table.
 *
 * An ordering hint, never a proof. The converting walk skips a document its
 * row says is done, so a run interrupted by its budget or a crash resumes
 * without reading everything again. The final walk reads every document again
 * whatever these rows say, so a row that is wrong (written by hand, or left
 * behind by a crash between a write and its record) skips nothing that still
 * needs converting.
 *
 * @module host-rewrite/progress
 */
import { and, asc, eq, inArray } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { componentDeletionHosts, componentDeletions } from "../schema/tables";

/** What a run recorded about one host document. */
export type HostState = "rewritten" | "unchanged" | "left" | "pending";

/** One document's recorded state. */
export interface HostProgress {
  readonly documentKey: string;
  readonly state: HostState;
  /** Why it was left, for a `left` document. */
  readonly reason: string | null;
}

/** How many documents of each state a run recorded. */
export type ProgressCounts = Readonly<Record<HostState, number>>;

/** The progress table's operations. */
export interface ProgressStore {
  /** Every document a run recorded, in no particular order. */
  all(runId: string): Promise<readonly HostProgress[]>;
  /**
   * Which of these documents the converting walk need not visit again: those
   * recorded `rewritten`, `unchanged` or `left`. A left document is settled for
   * that walk because visiting it again changes nothing until its author acts,
   * and a budgeted run that kept revisiting one would never get past it. Only
   * `pending`, a document a write re-queued, is visited again. The final walk
   * reads every document regardless, left ones included. Read by the keys
   * named, so a step reads the rows of the documents it passes.
   */
  settledAmong(
    runId: string,
    documentKeys: readonly string[]
  ): Promise<ReadonlySet<string>>;
  /** How many documents of each state a run recorded, counted in the database. */
  counts(runId: string): Promise<ProgressCounts>;
  /** The first `limit` documents a run left, by key. */
  leftPage(runId: string, limit: number): Promise<readonly HostProgress[]>;
  /** Record one document's state, replacing what was recorded. */
  record(
    runId: string,
    documentKey: string,
    state: HostState,
    reason?: string
  ): Promise<void>;
  /**
   * A finished run asked again: mark every document it left as pending and
   * move it from done back to its converting walk, in one transaction, so a
   * crash between the two cannot leave a done run with no left documents.
   * Answers false, changing nothing, when it left none.
   */
  reopenLeft(runId: string): Promise<boolean>;
}

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** A stored state, read strictly: anything else reads as still to do. */
function stateOf(value: string): HostState {
  return value === "rewritten" || value === "unchanged" || value === "left"
    ? value
    : "pending";
}

/** The table operations a record is written through: `ctx.db`, or a transaction. */
export type ProgressHandle = Pick<
  PluginTransaction,
  "select" | "table" | "update" | "insert"
>;

/**
 * Write one document's row, whether or not it exists yet: an update, and an
 * insert when it matched nothing.
 */
async function writeRow(
  handle: ProgressHandle,
  runId: string,
  documentKey: string,
  set: { state: HostState; reason: string | null }
): Promise<void> {
  const h = handle.table(componentDeletionHosts);
  const where = and(eq(h.deletionId, runId), eq(h.hostKey, documentKey));
  if (where === undefined) return;
  // Whether the row exists is read, not inferred from an update's count:
  // MySQL counts changed rows, so recording the state a row already holds
  // would read as no row at all.
  const held = await handle.select(componentDeletionHosts).where(where).first();
  if (held !== null) {
    await handle.update(componentDeletionHosts, set).where(where);
    return;
  }
  await handle.insert(componentDeletionHosts, {
    deletionId: runId,
    hostKey: documentKey,
    ...set,
  });
}

/**
 * Mark one document pending in a run's progress, through `handle`: a caller
 * sending the run back to its converting walk in the same transaction (a
 * write's own, for the component delete's fence), so the pending row and the
 * run's phase land together or not at all.
 */
export async function markPending(
  handle: ProgressHandle,
  runId: string,
  documentKey: string
): Promise<void> {
  await writeRow(handle, runId, documentKey, {
    state: "pending",
    reason: null,
  });
}

/**
 * Record one document as left in a run's progress, through `handle`, with
 * why: a document the run's walk did not strip and still owes.
 */
export async function markLeft(
  handle: ProgressHandle,
  runId: string,
  documentKey: string,
  reason: string
): Promise<void> {
  await writeRow(handle, runId, documentKey, { state: "left", reason });
}

/**
 * Mark every document a run left as pending again, through `handle` (a
 * transaction that also moves the run back to its converting walk). Answers
 * false, changing nothing, when the run left none.
 */
export async function leftToPending(
  handle: ProgressHandle,
  runId: string
): Promise<boolean> {
  const h = handle.table(componentDeletionHosts);
  const left = and(eq(h.deletionId, runId), eq(h.state, "left"));
  if (left === undefined) return false;
  if (
    (await handle.select(componentDeletionHosts).where(left).first()) === null
  ) {
    return false;
  }
  // Moves a value (left to pending), so no dialect reads it as matching
  // nothing.
  await handle
    .update(componentDeletionHosts, { state: "pending", reason: null })
    .where(left);
  return true;
}

/** The progress store over the plugin's own `ctx.db`. */
export function progressStore(
  db: Pick<
    PluginDatabase,
    "select" | "table" | "update" | "insert" | "transaction"
  >,
  dialect: Dialect
): ProgressStore {
  const all = async (runId: string): Promise<HostProgress[]> => {
    const h = db.table(componentDeletionHosts);
    const rows = await db
      .select(componentDeletionHosts)
      .where(eq(h.deletionId, runId))
      .all();
    return rows.map(row => ({
      documentKey: row.hostKey,
      state: stateOf(row.state),
      reason: row.reason,
    }));
  };

  const record = async (
    runId: string,
    documentKey: string,
    state: HostState,
    reason?: string
  ): Promise<void> => {
    const set = { state, reason: reason ?? null };
    try {
      await writeRow(db, runId, documentKey, set);
    } catch (error) {
      // Another writer inserted the row first: write over it instead.
      if (!isUniqueViolation(dialect, error)) throw error;
      await writeRow(db, runId, documentKey, set);
    }
  };

  const states: readonly HostState[] = [
    "rewritten",
    "unchanged",
    "left",
    "pending",
  ];
  return {
    all,
    settledAmong: async (runId, documentKeys) => {
      const settled = new Set<string>();
      if (documentKeys.length === 0) return settled;
      const h = db.table(componentDeletionHosts);
      const where = and(
        eq(h.deletionId, runId),
        inArray(h.hostKey, [...documentKeys])
      );
      if (where === undefined) return settled;
      for (const row of await db
        .select(componentDeletionHosts)
        .where(where)
        .all()) {
        if (stateOf(row.state) !== "pending") settled.add(row.hostKey);
      }
      return settled;
    },
    counts: async runId => {
      const h = db.table(componentDeletionHosts);
      const counted = await Promise.all(
        states.map(async state => {
          const where = and(eq(h.deletionId, runId), eq(h.state, state));
          return where === undefined
            ? 0
            : db.select(componentDeletionHosts).where(where).count();
        })
      );
      return {
        rewritten: counted[0] ?? 0,
        unchanged: counted[1] ?? 0,
        left: counted[2] ?? 0,
        pending: counted[3] ?? 0,
      };
    },
    leftPage: async (runId, limit) => {
      const h = db.table(componentDeletionHosts);
      const where = and(eq(h.deletionId, runId), eq(h.state, "left"));
      if (where === undefined) return [];
      const rows = await db
        .select(componentDeletionHosts)
        .where(where)
        .orderBy(asc(h.hostKey))
        .limit(limit)
        .all();
      return rows.map(row => ({
        documentKey: row.hostKey,
        state: stateOf(row.state),
        reason: row.reason,
      }));
    },
    record,
    reopenLeft: runId =>
      db.transaction(async tx => {
        if (!(await leftToPending(tx, runId))) return false;
        // Moves a value (done to converting), so no dialect reads it as
        // matching nothing.
        const t = tx.table(componentDeletions);
        const done = and(eq(t.id, runId), eq(t.phase, "done"));
        if (done !== undefined) {
          await tx
            .update(componentDeletions, { phase: "converting", cursor: null })
            .where(done);
        }
        return true;
      }),
  };
}
