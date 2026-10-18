/**
 * What goes with a collection or Single when it is deleted, from the versions
 * domain: its autosaves (recovery points nothing else collects once the
 * entity is gone) and the pins features hold on its versions (which nothing
 * could release once the entity is gone, and which a later entity under the
 * same slug must not inherit).
 *
 * Durable history and working drafts are deliberately NOT touched. What a
 * deletion owes a document's recorded past is a wider question, and answering
 * it as a side effect here would decide it by accident.
 *
 * One function for every path that deletes an entity's registry row (both
 * registries, a sync's orphan removal, the dev build's), so they cannot come
 * to sweep different things, or to sweep in a different order.
 *
 * @module domains/versions/entity-teardown
 */

import type { VersionScopeKind } from "../../schemas/versions/types";

import type { VersionsDbApi } from "./db-api";
import { REGISTRY_TABLES } from "./history-locks";
import { deletePinsForDocument, deletePinsForEntity } from "./version-pins";
import { deleteViewsForDocument, deleteViewsForEntity } from "./version-views";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/**
 * Delete an entity's registry row, then its autosaves and version pins, on
 * the caller's transaction. Returns how many registry rows were deleted.
 *
 * The row goes FIRST. A pin locks this row before it writes, so deleting it
 * first takes the same lock in the same order: a pin under way finishes, and
 * the sweep after it removes what it wrote; a pin that comes later finds the
 * entity gone. Sweeping first would take no lock a pin waits on, so a pin
 * holding the row could write after the sweep and outlive the entity, and a
 * pin moving a slot the sweep had locked would deadlock with it.
 */
export async function deleteEntityRegistryRow(
  tx: VersionsDbApi,
  scopeKind: VersionScopeKind,
  scopeSlug: string
): Promise<number> {
  const registry = REGISTRY_TABLES[scopeKind];
  if (registry === undefined) return 0;
  const deleted = await tx.delete(registry, {
    and: [{ column: "slug", op: "=" as const, value: scopeSlug }],
  });
  await new VersionsRepository(tx).deleteAutosavesForEntity(
    scopeKind,
    scopeSlug
  );
  await deletePinsForEntity(tx, scopeKind, scopeSlug);
  await deleteViewsForEntity(tx, scopeKind, scopeSlug);
  return deleted;
}

/**
 * Remove what the versions domain holds on one deleted document, on the
 * delete's own transaction: the pins features hold on its versions, and each
 * person's "last looked at" marker on it. Nothing could release or read
 * either once the document is gone.
 */
export async function sweepDeletedDocument(
  tx: VersionsDbApi,
  ref: VersionRef
): Promise<void> {
  await deletePinsForDocument(tx, ref);
  await deleteViewsForDocument(tx, ref);
}
