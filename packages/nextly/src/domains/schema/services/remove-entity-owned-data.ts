/**
 * Removing what a deleted collection, Single or field group owned outside its own tables: the
 * one implementation every delete runs, the Builder's in development and `nextly migrate` on a
 * deployed database, so the two leave the same database behind.
 *
 * What an entity owns, and when its delete removes each kind, is declared once
 * (`entity-owned-data.ts`). The rows its delete removes before the entity's tables go (its
 * field-group values and its translation rows) are removed here by kind, in the declaration's
 * order, and the kinds come from the declaration, so a kind added there with no step here does not
 * compile. The registry row and what goes with it are removed last, together, by
 * `deleteEntityRegistryRow` for a collection or a Single and {@link removeFieldGroupRegistryRow}
 * for a field group.
 *
 * Where the rows go relative to the tables is the caller's: a development delete removes them
 * before its drops, in the drops' transaction; `nextly migrate` removes them after the migration
 * file that dropped the tables is recorded applied, each kind on its own, the registry row last.
 * Every step is scoped to the one entity, by its kind and slug or, for field-group values, by the
 * table they name as their parent, and removes nothing a second time, so a run stopped part-way
 * is finished by running the steps again.
 *
 * @module domains/schema/services/remove-entity-owned-data
 */
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  teardownEntityComponentData,
  type TeardownComponentDataAdapter,
} from "../../field-groups/services/teardown-entity-field-group-data";
import {
  forgetEntityTranslationTransition,
  removeEntityTranslationArchive,
  removeEntityTranslationProvenance,
} from "../../i18n/migration/teardown-entity-i18n";

import {
  ENTITY_OWNED_DATA,
  type EntityOwnedData,
  type OwningEntityKind,
} from "./entity-owned-data";

/** The deleted entity: its kind, its slug, and its own (main) table, which its field-group values name. */
export interface OwningEntity {
  kind: OwningEntityKind;
  slug: string;
  table: string;
}

/** The kinds of row a delete removes before the entity's tables go, as the declaration names them. */
export type RowRemovedBeforeTheDrop =
  | "fieldGroupValues"
  | "translationArchive"
  | "translationTransition"
  | "translationProvenance";

/**
 * How each kind is removed, through the delete's adapter (its transaction, where it runs in one).
 * Keyed by every kind, so a kind with no step does not compile.
 */
const REMOVE: Record<
  RowRemovedBeforeTheDrop,
  (
    adapter: TeardownComponentDataAdapter,
    entity: OwningEntity
  ) => Promise<unknown>
> = {
  fieldGroupValues: (adapter, entity) =>
    teardownEntityComponentData({ adapter, parentTable: entity.table }),
  translationArchive: (adapter, entity) =>
    removeEntityTranslationArchive(adapter, entity),
  translationTransition: (adapter, entity) =>
    forgetEntityTranslationTransition(adapter, entity),
  translationProvenance: (adapter, entity) =>
    removeEntityTranslationProvenance(adapter, entity),
};

function isRemovedBeforeTheDrop(
  data: EntityOwnedData
): data is RowRemovedBeforeTheDrop {
  return Object.hasOwn(REMOVE, data);
}

/**
 * The kinds of row `kind`'s delete removes before its tables go, in the declaration's order. The
 * translations table, which the declaration also removes before the drop, is a table: the delete
 * drops it with the entity's other tables.
 */
export function rowsRemovedBeforeTheDrop(
  kind: OwningEntityKind
): RowRemovedBeforeTheDrop[] {
  return ENTITY_OWNED_DATA[kind]
    .filter(entry => entry.removed === "beforeTheDrop")
    .map(entry => entry.data)
    .filter(isRemovedBeforeTheDrop);
}

/** Removes `entity`'s rows of one kind, through `adapter`. */
export async function removeOwnedRows(
  adapter: TeardownComponentDataAdapter,
  entity: OwningEntity,
  data: RowRemovedBeforeTheDrop
): Promise<void> {
  await REMOVE[data](adapter, entity);
}

/**
 * Removes every kind of row `entity`'s delete removes before its tables go, in order, through
 * `adapter`: what a development delete runs before its drops, in their transaction.
 */
export async function removeRowsBeforeTheDrop(
  adapter: TeardownComponentDataAdapter,
  entity: OwningEntity
): Promise<void> {
  for (const data of rowsRemovedBeforeTheDrop(entity.kind)) {
    await removeOwnedRows(adapter, entity, data);
  }
}

/** What a field group's registry row is removed through: the delete's transaction, where it runs in one. */
export interface FieldGroupRegistryAdapter {
  delete(table: string, where: WhereClause): Promise<number>;
}

/**
 * Removes a field group's registry row from `registryTable` (`resolveRegistryTableName`), and
 * returns how many rows went. A field group has no versions, pins or documents of its own, so its
 * row is all that goes with it.
 */
export async function removeFieldGroupRegistryRow(
  adapter: FieldGroupRegistryAdapter,
  registryTable: string,
  slug: string
): Promise<number> {
  const removed = await adapter.delete(registryTable, {
    and: [{ column: "slug", op: "=", value: slug }],
  });
  // Cleared as the row goes, as `deleteEntityRegistryRow` clears for the other kinds, so a read
  // later in the transaction does not find it.
  clearRegistryRowCache();
  return removed;
}
