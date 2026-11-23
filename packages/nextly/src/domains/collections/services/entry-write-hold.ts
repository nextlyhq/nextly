/**
 * An entry write's hold on its collection against a Builder save that deletes a field's values.
 *
 * A save that removes a field holding values counts them again just before it deletes them, and
 * deletes only the count the person confirmed. It holds the collection from that count until its
 * registry row records the new definition, and every entry write to the collection takes the same
 * hold's share side first in its transaction: the write waits while such a save holds it, and a
 * save waits for writes already under way to end. Each database holds it its own way:
 *
 * - MySQL: `holdCollectionsIn(tx, [slug], "share")`, the collection's named locks, taken and
 *   released across a read of its registry row `FOR SHARE`, which then lasts until the write's
 *   transaction ends.
 * - PostgreSQL: the entity's advisory lock, shared (`shareEntityOnPostgres`), until the write's
 *   transaction ends; then the same registry read.
 * - SQLite: the entity's lock in this process (`shareEntityInProcess`), which `entryTransaction`
 *   takes before the write's transaction opens; a write on a transaction already open is refused
 *   while a save holds it (`refuseWhileHeldInProcess`).
 *
 * The hold is taken once per transaction and collection, so a batch that holds it before its first
 * item takes nothing more for each item.
 *
 * Under the hold, the registry row is compared with the one the write was made for: the row its
 * operation loaded its fields from (`loadedRegistryRowOf`). A write whose collection was deleted
 * while it waited, or deleted and made again under its slug, is refused rather than written into
 * what took its place. And where a save changed the definition since (its `schema_version`), a
 * field the write sets that the definition no longer has is refused by name, with nothing written.
 *
 * @module domains/collections/services/entry-write-hold
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { DynamicCollectionService } from "../../dynamic-collections";
import {
  type EntityRef,
  entityHoldKey,
  refuseWhileHeldInProcess,
  shareEntityOnPostgres,
} from "../../dynamic-collections/services/entity-hold";
import { fieldsStoredOnRow } from "../../schema/services/field-column-descriptor";

/** What the hold is taken through: the registry's `holdCollectionsIn`. */
export type CollectionHolder = Pick<
  DynamicCollectionService,
  "holdCollectionsIn"
>;

/**
 * The adapter a write goes through, as the hold needs it: its dialect, and whether a transaction
 * is already open in the flow. It is also what this process's hold on SQLite is kept by.
 */
export interface HoldingAdapter {
  getCapabilities(): { dialect: SupportedDialect };
  transactionOpenInFlow(): boolean;
}

/**
 * The registry row a write was made for: the id and schema version of the row its operation loaded
 * its fields from, and the fields of that definition the write sets.
 */
export interface LoadedRegistryRow {
  readonly id: string;
  readonly schemaVersion: number | undefined;
  readonly setsFields: readonly string[];
}

/**
 * The registry row `row` (a collection's, as `getCollection` answers it) as a write made from it
 * holds it: its id, its schema version, and the fields of its definition that `data` sets.
 * Undefined where the row carries no id, so nothing is compared.
 */
export function loadedRegistryRowOf(
  row: unknown,
  data?: Readonly<Record<string, unknown>>
): LoadedRegistryRow | undefined {
  const { id, schemaVersion, fields } = (row ?? {}) as {
    id?: unknown;
    schemaVersion?: unknown;
    fields?: unknown;
  };
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const version = Number(schemaVersion);
  const sets =
    data === undefined
      ? []
      : fieldNamesOf(fields).filter(name => Object.hasOwn(data, name));
  return {
    id: String(id),
    schemaVersion: Number.isFinite(version) ? version : undefined,
    setsFields: sets,
  };
}

/** The names a definition's `fields` answer to in an entry's data (`fieldsStoredOnRow`). */
function fieldNamesOf(fields: unknown): string[] {
  const list = typeof fields === "string" ? parsedFields(fields) : fields;
  if (!Array.isArray(list)) return [];
  return fieldsStoredOnRow(list as Array<{ name?: unknown }>).flatMap(field =>
    typeof field?.name === "string" ? [field.name] : []
  );
}

/** A stored `fields` column read as JSON text: the list it holds, or none. */
function parsedFields(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return [];
  }
}

/** The collections each open transaction already holds for its entry writes. */
const heldIn = new WeakMap<TransactionContext, Set<string>>();

/**
 * Holds `entity` for an entry write in `tx`, through `adapter`, before the write's first row
 * statement, once per transaction: refused, with nothing written, when a save holds it past the
 * hold's wait. With `loaded`, the registry row held is compared with it (`refuseChanged`).
 * `sharedInProcess` says the write's SQLite share was taken before `tx` opened
 * (`entryTransaction`); without it, on SQLite, the write is refused while a save holds the entity.
 */
export async function holdEntityForWrite(
  tx: TransactionContext,
  entity: EntityRef,
  holder: CollectionHolder,
  adapter: HoldingAdapter,
  loaded?: LoadedRegistryRow,
  options?: { sharedInProcess?: boolean }
): Promise<void> {
  const key = entityHoldKey(entity);
  const held = heldIn.get(tx);
  if (held?.has(key)) return;
  const dialect = adapter.getCapabilities().dialect;
  if (dialect === "postgresql") {
    await shareEntityOnPostgres(query => tx.queryStatement(query), entity);
  } else if (dialect === "sqlite" && options?.sharedInProcess !== true) {
    refuseWhileHeldInProcess(adapter, entity);
  }
  const { existing, ids, versions } = await holder.holdCollectionsIn(
    tx,
    [entity.slug],
    "share"
  );
  if (loaded !== undefined) {
    await refuseChanged(tx, entity, loaded, {
      present: existing.includes(entity.slug),
      id: ids.get(entity.slug),
      version: versions.get(entity.slug),
    });
  }
  if (held === undefined) heldIn.set(tx, new Set([key]));
  else held.add(key);
}

/**
 * Refuses a write whose collection's registry row, as held, is not the one it was made for
 * (`loaded`): gone (`NOT_FOUND`), or another row under the same slug, made while the write waited
 * (`COLLECTION_BEING_CHANGED`). Where the row is the same and a save changed its definition since
 * (its schema version moved), a field the write sets that the held definition no longer has is
 * refused by name. Nothing of the write has run.
 */
async function refuseChanged(
  tx: TransactionContext,
  entity: EntityRef,
  loaded: LoadedRegistryRow,
  held: {
    present: boolean;
    id: string | undefined;
    version: number | undefined;
  }
): Promise<void> {
  if (!held.present) {
    throw NextlyError.notFound({
      message: "Collection not found.",
      logContext: {
        reason: "collection-deleted-while-held",
        slug: entity.slug,
      },
    });
  }
  if (held.id !== loaded.id) throw replacedWhileHeld(entity.slug);
  if (
    loaded.setsFields.length === 0 ||
    loaded.schemaVersion === undefined ||
    held.version === loaded.schemaVersion
  ) {
    return;
  }
  const row = await tx.selectOne<{ fields: unknown }>("dynamic_collections", {
    columns: ["fields"],
    where: { and: [{ column: "slug", op: "=", value: entity.slug }] },
  });
  const remaining = new Set(fieldNamesOf(row?.fields));
  const removed = loaded.setsFields.filter(name => !remaining.has(name));
  if (removed.length === 0) return;
  throw NextlyError.validation({
    errors: removed.map(name => ({
      path: `fields.${name}`,
      code: "FIELD_REMOVED",
      message: `${name} was removed from this collection while this write waited for a change to it, so nothing was written. Review the entry and save it again.`,
    })),
    logContext: {
      reason: "field-removed-while-held",
      slug: entity.slug,
      fields: removed,
    },
  });
}

/** The refusal of a write whose collection was made again under its slug while it waited. */
function replacedWhileHeld(slug: string): NextlyError {
  return new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
    logContext: { reason: "collection-replaced-while-held", slug },
  });
}
