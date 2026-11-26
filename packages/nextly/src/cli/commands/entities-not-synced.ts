/**
 * The entities a `db:sync` run could not sync: a column or a table of theirs the database refused.
 *
 * The run's auto-sync steps note each such entity (recording it `failed` is theirs), and the run
 * reads them once everything else has run, so it can end with one error naming them all. Collected
 * for the length of one run's async work rather than returned through every sync step between,
 * as `runWithFieldTypes` pins a run's field types.
 *
 * @module cli/commands/entities-not-synced
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { ColumnsNotAddedError } from "../../domains/schema/utils/missing-columns";
import { describeError } from "../../errors";

/** An entity a run could not sync, and what the database said. */
export interface EntityNotSynced {
  kind: "single" | "field group";
  slug: string;
  /** Each refused column with its reason, or why the table could not be made. */
  detail: string;
}

const collected = new AsyncLocalStorage<EntityNotSynced[]>();

/**
 * Runs `work`, answering with what it returned and every entity it could not sync, each once.
 */
export async function collectEntitiesNotSynced<T>(
  work: () => Promise<T>
): Promise<{ value: T; notSynced: EntityNotSynced[] }> {
  const notSynced: EntityNotSynced[] = [];
  const value = await collected.run(notSynced, work);
  return { value, notSynced };
}

/**
 * Notes that `slug` could not be synced, for the run collecting them. A step that syncs the same
 * entity twice in a run (the settings pass after the first) keeps its first reason.
 */
export function noteEntityNotSynced(
  kind: EntityNotSynced["kind"],
  slug: string,
  error: unknown
): void {
  const notSynced = collected.getStore();
  if (notSynced === undefined) return;
  if (notSynced.some(entity => entity.kind === kind && entity.slug === slug)) {
    return;
  }
  notSynced.push({ kind, slug, detail: detailOf(error) });
}

/**
 * Notes that `slug` was synced, for the run collecting them: a later pass of the same run (the
 * settings pass after the first) that brings an entity up to date clears what an earlier one noted,
 * so the run never ends naming an entity it recorded applied.
 */
export function noteEntitySynced(
  kind: EntityNotSynced["kind"],
  slug: string
): void {
  const notSynced = collected.getStore();
  if (notSynced === undefined) return;
  const at = notSynced.findIndex(
    entity => entity.kind === kind && entity.slug === slug
  );
  if (at !== -1) notSynced.splice(at, 1);
}

/** Each refused column with the database's reason, or the error's own description. */
function detailOf(error: unknown): string {
  if (error instanceof ColumnsNotAddedError) {
    return error.refused
      .map(({ column, reason }) => `${column}: ${reason}`)
      .join("; ");
  }
  return describeError(error, { context: false });
}
