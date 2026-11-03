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
  /** The documents a run recorded as finished (`rewritten` or `unchanged`). */
  finished(runId: string): Promise<ReadonlySet<string>>;
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
   * while its run was open: mark it pending and send the run back to its
   * converting walk, so it is read again whichever write committed last.
   */
  requeue(componentIds: readonly string[], documentKey: string): Promise<void>;
}

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** A stored state, read strictly: anything else reads as still to do. */
function stateOf(value: string): HostState {
  return value === "rewritten" || value === "unchanged" || value === "left"
    ? value
    : "pending";
}

/** The progress store over the plugin's own `ctx.db`. */
export function progressStore(
  db: Pick<PluginDatabase, "select" | "table" | "update" | "insert">,
  dialect: Dialect
): ProgressStore {
  const h = db.table(componentDeletionHosts);
  const all = async (runId: string): Promise<HostProgress[]> => {
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
    const where = and(eq(h.deletionId, runId), eq(h.hostKey, documentKey));
    if (where === undefined) return;
    if ((await db.update(componentDeletionHosts, set).where(where)) > 0) return;
    try {
      await db.insert(componentDeletionHosts, {
        deletionId: runId,
        hostKey: documentKey,
        ...set,
      });
    } catch (error) {
      // Another writer inserted the row first: write over it instead.
      if (!isUniqueViolation(dialect, error)) throw error;
      await db.update(componentDeletionHosts, set).where(where);
    }
  };

  return {
    all,
    record,
    finished: async runId =>
      new Set(
        (await all(runId))
          .filter(row => row.state === "rewritten" || row.state === "unchanged")
          .map(row => row.documentKey)
      ),
    requeue: async (componentIds, documentKey) => {
      if (componentIds.length === 0) return;
      const r = db.table(componentDeletions);
      const runs = await db
        .select(componentDeletions)
        .where(inArray(r.componentId, [...componentIds]))
        .all();
      for (const run of runs) {
        await record(run.id, documentKey, "pending");
        await db
          .update(componentDeletions, { phase: "converting", cursor: null })
          .where(eq(r.id, run.id));
      }
    },
  };
}
