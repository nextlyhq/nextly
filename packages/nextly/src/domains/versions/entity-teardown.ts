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
 * One function for both registries, so the two deletions cannot come to
 * sweep different things.
 *
 * @module domains/versions/entity-teardown
 */

import type { VersionScopeKind } from "../../schemas/versions/types";

import type { VersionsDbApi } from "./db-api";
import { deletePinsForEntity } from "./version-pins";
import { VersionsRepository } from "./versions-repository";

/**
 * Remove an entity's autosaves and version pins, on the caller's transaction:
 * the registry deletes them in the same transaction as the entity's row.
 */
export async function sweepDeletedEntityVersions(
  tx: VersionsDbApi,
  scopeKind: VersionScopeKind,
  scopeSlug: string
): Promise<void> {
  await new VersionsRepository(tx).deleteAutosavesForEntity(
    scopeKind,
    scopeSlug
  );
  await deletePinsForEntity(tx, scopeKind, scopeSlug);
}
