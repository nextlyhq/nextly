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
import { and, eq, inArray } from "@nextlyhq/plugin-sdk/db";
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

/** The progress table's operations. */
export interface ProgressStore {
  /** Every document a run recorded, in no particular order. */
  all(runId: string): Promise<readonly HostProgress[]>;
  /** Record one document's state, replacing what was recorded. */
  record(
    runId: string,
    documentKey: string,
    state: HostState,
    reason?: string
  ): Promise<void>;
  /**
   * A document holding a reference to one of these components was written
   * while its `delete` run was open: mark it pending and send the run back to
   * its converting walk, so it is read again whichever write committed last.
   */
  requeue(componentIds: readonly string[], documentKey: string): Promise<void>;
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
type ProgressHandle = Pick<
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

  return {
    all,
    record,
    requeue: async (componentIds, documentKey) => {
      if (componentIds.length === 0) return;
      const r = db.table(componentDeletions);
      const runs = await db
        .select(componentDeletions)
        .where(inArray(r.componentId, [...componentIds]))
        .all();
      // Only a delete run fences references, so only its documents are
      // re-queued for holding one.
      for (const run of runs.filter(row => row.purpose !== "strip-retired")) {
        // ONE transaction: a pending row with the run left in its final walk,
        // or done, would never be visited again, so the two land together or
        // neither does.
        await db.transaction(async tx => {
          await writeRow(tx, run.id, documentKey, {
            state: "pending",
            reason: null,
          });
          const t = tx.table(componentDeletions);
          await tx
            .update(componentDeletions, { phase: "converting", cursor: null })
            .where(eq(t.id, run.id));
        });
      }
    },
    reopenLeft: runId =>
      db.transaction(async tx => {
        const h = tx.table(componentDeletionHosts);
        const left = and(eq(h.deletionId, runId), eq(h.state, "left"));
        if (left === undefined) return false;
        if (
          (await tx.select(componentDeletionHosts).where(left).first()) === null
        ) {
          return false;
        }
        // Each statement moves a value (left to pending, done to
        // converting), so no dialect reads it as matching nothing.
        await tx
          .update(componentDeletionHosts, { state: "pending", reason: null })
          .where(left);
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
