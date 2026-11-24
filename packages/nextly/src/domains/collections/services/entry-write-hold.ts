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
 *   transaction ends; then a plain read of its registry row, the lock being the hold.
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
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  type EntityRef,
  entityHoldKey,
  refuseUnlessSharedOnPostgres,
  refuseWhileHeldInProcess,
  type RowsOn,
  shareEntityOnPostgres,
  tryShareEntityOnPostgres,
} from "../../dynamic-collections/services/entity-hold";
import { fieldsStoredOnRow } from "../../schema/services/field-column-descriptor";
import { fieldsStoredDifferently } from "../../schema/services/fields-stored-differently";

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
 * its fields from, the fields of that definition (`fields`, and as they are stored on the row,
 * `stored`), and those of them the write sets. `insertsOnly` marks a create, which writes only the
 * columns its data sets and reads no entry through the definition first.
 */
export interface LoadedRegistryRow {
  readonly id: string;
  readonly schemaVersion: number | undefined;
  readonly fields: readonly string[];
  readonly stored: readonly FieldDefinition[];
  readonly setsFields: readonly string[];
  readonly insertsOnly?: true;
}

/** An entry's data, or a batch's items, each an entry's data. */
type WrittenData =
  | Readonly<Record<string, unknown>>
  | readonly Readonly<Record<string, unknown>>[];

/**
 * The registry row `row` (a collection's, as `getCollection` answers it) as a write made from it
 * holds it: its id, its schema version, its definition's fields, and those of them that `data`
 * (an entry's data, or a batch's items) sets. With `insertsOnly`, for a create. Undefined where the
 * row carries no id, so nothing is compared.
 */
export function loadedRegistryRowOf(
  row: unknown,
  data?: WrittenData,
  options?: { insertsOnly?: boolean }
): LoadedRegistryRow | undefined {
  const { id, schemaVersion, fields } = (row ?? {}) as {
    id?: unknown;
    schemaVersion?: unknown;
    fields?: unknown;
  };
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const version = Number(schemaVersion);
  const stored = storedFieldsOf(fields);
  const names = stored.map(field => field.name);
  const sets = data === undefined ? [] : names.filter(setBy(data));
  return {
    id: String(id),
    schemaVersion: Number.isFinite(version) ? version : undefined,
    fields: names,
    stored,
    setsFields: sets,
    ...(options?.insertsOnly === true ? { insertsOnly: true as const } : {}),
  };
}

/**
 * Whether `data` sets a field, by its name: an entry's own keys, or any of a batch's items'. A
 * batch's keys are gathered one item at a time, since a batch has no upper size.
 */
function setBy(data: WrittenData): (name: string) => boolean {
  if (!isItems(data)) return name => Object.hasOwn(data, name);
  const keys = new Set<string>();
  for (const item of data) {
    for (const key of Object.keys(item)) keys.add(key);
  }
  return name => keys.has(name);
}

function isItems(
  data: WrittenData
): data is readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(data);
}

/** A definition's fields as they are stored on the entry's row (`fieldsStoredOnRow`), by name. */
function storedFieldsOf(fields: unknown): FieldDefinition[] {
  const list = typeof fields === "string" ? parsedFields(fields) : fields;
  if (!Array.isArray(list)) return [];
  return fieldsStoredOnRow(list as FieldDefinition[]).filter(
    field => typeof field?.name === "string"
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

/**
 * What a write does where a save holds its entity on PostgreSQL: waits in its transaction, gives it
 * up to wait outside it and be made again, or is refused at once.
 */
export type WhenHeld = "wait" | "leave" | "refuse";

/** The collections each open transaction already holds for its entry writes. */
const heldIn = new WeakMap<TransactionContext, Set<string>>();

/**
 * Holds `entity` for an entry write in `tx`, through `adapter`, before the write's first row
 * statement, once per transaction: refused, with nothing written, when a save holds it past the
 * hold's wait. With `loaded`, the registry row held is compared with it (`refuseChanged`).
 * `sharedInProcess` says the write's SQLite share was taken before `tx` opened
 * (`entryTransaction`); without it, on SQLite, the write is refused while a save holds the entity.
 *
 * On PostgreSQL, where a save holds the entity, `whenHeld` says what the write does: it waits in
 * `tx` (`"wait"`), it gives `tx` up to wait outside it and be made again (`"leave"`, answering
 * false), or it is refused at once (`"refuse"`). Answers whether the entity is held for the write.
 */
export async function holdEntityForWrite(
  tx: TransactionContext,
  entity: EntityRef,
  holder: CollectionHolder,
  adapter: HoldingAdapter,
  loaded?: LoadedRegistryRow,
  options?: { sharedInProcess?: boolean; whenHeld?: WhenHeld }
): Promise<boolean> {
  const key = entityHoldKey(entity);
  const held = heldIn.get(tx);
  if (held?.has(key)) return true;
  const dialect = adapter.getCapabilities().dialect;
  if (!(await sharedForWrite(tx, entity, adapter, dialect, options))) {
    return false;
  }
  const row = await heldRegistryRow(tx, entity, holder, dialect);
  if (loaded !== undefined) {
    await refuseChanged(tx, entity, loaded, dialect, heldRowOf(row));
  }
  if (held === undefined) heldIn.set(tx, new Set([key]));
  else held.add(key);
  return true;
}

/** Whether an entry write has its share of `entity` in `tx`, as each database holds it. */
async function sharedForWrite(
  tx: TransactionContext,
  entity: EntityRef,
  adapter: HoldingAdapter,
  dialect: SupportedDialect,
  options: { sharedInProcess?: boolean; whenHeld?: WhenHeld } | undefined
): Promise<boolean> {
  if (dialect === "postgresql") {
    const rows: RowsOn = query => tx.queryStatement(query);
    return sharedOnPostgres(rows, entity, options?.whenHeld);
  }
  // MySQL's share is its registry row's own read (`heldRegistryRow`).
  if (dialect === "sqlite" && options?.sharedInProcess !== true) {
    refuseWhileHeldInProcess(adapter, entity);
  }
  return true;
}

/** A write's share of `entity` on PostgreSQL, where a save holds it as `whenHeld` says. */
async function sharedOnPostgres(
  rows: RowsOn,
  entity: EntityRef,
  whenHeld: WhenHeld | undefined
): Promise<boolean> {
  if (whenHeld === "leave") return tryShareEntityOnPostgres(rows, entity);
  if (whenHeld === "refuse") await refuseUnlessSharedOnPostgres(rows, entity);
  else await shareEntityOnPostgres(rows, entity);
  return true;
}

/**
 * The registry row as it stands once held: on MySQL the share side's own read, `FOR SHARE`;
 * elsewhere a plain read, the entity's lock being the hold, so concurrent writes lock no row of
 * the registry. A row read through the adapter is keyed by the table's property names, so the
 * version is `schemaVersion`.
 */
function heldRegistryRow(
  tx: TransactionContext,
  entity: EntityRef,
  holder: CollectionHolder,
  dialect: SupportedDialect
): Promise<HeldRegistryRow | null | undefined> {
  return dialect === "mysql"
    ? heldRegistryRowOnMysql(tx, entity, holder)
    : tx.selectOne<HeldRegistryRow>("dynamic_collections", {
        columns: ["id", "schema_version"],
        where: { and: [{ column: "slug", op: "=", value: entity.slug }] },
      });
}

/** The registry row a hold reads: its id and the version its definition is at. */
interface HeldRegistryRow {
  id: unknown;
  schemaVersion: unknown;
}

/** A row read, as `refuseChanged` compares it: whether it is there, its id and its version. */
function heldRowOf(row: HeldRegistryRow | null | undefined): {
  present: boolean;
  id: string | undefined;
  version: number | undefined;
} {
  if (row === null || row === undefined) {
    return { present: false, id: undefined, version: undefined };
  }
  return {
    present: true,
    id: String(row.id),
    version: Number(row.schemaVersion),
  };
}

/** The collection's registry row read by MySQL's share side (`holdCollectionsIn`), or none. */
async function heldRegistryRowOnMysql(
  tx: TransactionContext,
  entity: EntityRef,
  holder: CollectionHolder
): Promise<{ id: unknown; schemaVersion: unknown } | undefined> {
  const { existing, ids, versions } = await holder.holdCollectionsIn(
    tx,
    [entity.slug],
    "share"
  );
  if (!existing.includes(entity.slug)) return undefined;
  return {
    id: ids.get(entity.slug),
    schemaVersion: versions.get(entity.slug),
  };
}

/**
 * Refuses a write whose collection's registry row, as held, is not the one it was made for
 * (`loaded`): gone (`NOT_FOUND`), or another row under the same slug, made while the write waited
 * (`COLLECTION_BEING_CHANGED`). Where the row is the same and a save changed its definition since
 * (its schema version moved), a field the write sets that the held definition no longer has is
 * refused by name; and a write that reads the entry as it stands, made from a definition with a
 * field the held one no longer has, is refused as made for a definition that changed
 * (`COLLECTION_BEING_CHANGED`), since its read names that field's column; the same for a field
 * kept by name but stored differently (`fieldsStoredDifferently`). A create reads no entry first
 * and writes only the columns its data sets, so it is refused where one of those is removed or
 * stored differently, and otherwise goes on. Nothing of the write has run.
 */
async function refuseChanged(
  tx: TransactionContext,
  entity: EntityRef,
  loaded: LoadedRegistryRow,
  dialect: SupportedDialect,
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
    loaded.schemaVersion === undefined ||
    held.version === loaded.schemaVersion
  ) {
    return;
  }
  const row = await tx.selectOne<{ fields: unknown }>("dynamic_collections", {
    columns: ["fields"],
    where: { and: [{ column: "slug", op: "=", value: entity.slug }] },
  });
  const heldFields = storedFieldsOf(row?.fields);
  // Made again from the definition as it stands, however it is refused: the rows this process
  // keeps of it are cleared, so a retry reads it rather than the one the write was made from.
  clearRegistryRowCache();
  const set = setFieldsNotAsHeld(loaded, heldFields, dialect);
  if (set.length > 0) throw setFieldsChangedWhileHeld(entity.slug, set);
  // A create reads no entry through the definition and writes only the columns its data sets: none
  // of them changed, so it goes on.
  if (loaded.insertsOnly === true) return;
  // Any other write reads the entry through the definition it was made from.
  if (madeFromWhatHolds(loaded, heldFields, dialect)) return;
  throw changedWhileHeld(entity.slug);
}

/** A field a write sets, and what a save did to it: `"removed"`, or `"changed"` how it is stored. */
interface SetField {
  readonly name: string;
  readonly was: "removed" | "changed";
}

/**
 * The fields a write made from `loaded` sets that the held definition (`held`) no longer has, or
 * keeps by name but stores differently: a value written there would go to no column, or be written
 * as the earlier type or to the earlier relation. Each is named to the person.
 */
function setFieldsNotAsHeld(
  loaded: LoadedRegistryRow,
  held: readonly FieldDefinition[],
  dialect: SupportedDialect
): SetField[] {
  if (loaded.setsFields.length === 0) return [];
  const names = new Set(held.map(field => field.name));
  const different = storedDifferently(loaded, held, dialect);
  return loaded.setsFields.flatMap((name): SetField[] => {
    if (!names.has(name)) return [{ name, was: "removed" }];
    return different.has(name) ? [{ name, was: "changed" }] : [];
  });
}

/** The fields `held` keeps from `loaded`, by name, but stores differently (`fieldsStoredDifferently`). */
function storedDifferently(
  loaded: LoadedRegistryRow,
  held: readonly FieldDefinition[],
  dialect: SupportedDialect
): ReadonlySet<string> {
  return fieldsStoredDifferently({
    previous: loaded.stored,
    next: held,
    dialect,
    // A collection's table is built by the collection's generator.
    builtBy: "collection",
  });
}

/**
 * Whether a write that reads the entry first was made from a definition that still holds: each of
 * its fields is there, stored as it was. One that was taken out, or is stored differently, is not.
 */
function madeFromWhatHolds(
  loaded: LoadedRegistryRow,
  held: readonly FieldDefinition[],
  dialect: SupportedDialect
): boolean {
  const names = new Set(held.map(field => field.name));
  if (loaded.fields.some(name => !names.has(name))) return false;
  const different = storedDifferently(loaded, held, dialect);
  return !loaded.fields.some(name => different.has(name));
}

/** The refusal of a write that sets fields a save removed or stores differently, naming each. */
function setFieldsChangedWhileHeld(
  slug: string,
  set: readonly SetField[]
): NextlyError {
  return NextlyError.validation({
    errors: set.map(({ name, was }) => ({
      path: `fields.${name}`,
      code: was === "removed" ? "FIELD_REMOVED" : "FIELD_CHANGED",
      message:
        was === "removed"
          ? `${name} was removed from this collection while this write waited for a change to it, so nothing was written. Review the entry and save it again.`
          : `${name} changed while this write waited for a change to this collection, so nothing was written. Review the entry and save it again.`,
    })),
    logContext: {
      reason: "set-fields-changed-while-held",
      slug,
      fields: set.map(({ name, was }) => ({ name, was })),
    },
  });
}

/**
 * The refusal of a write made from a definition a save changed while it waited, taking out, or
 * storing differently, a field the write does not set: to be made again from the definition as it
 * stands.
 */
function changedWhileHeld(slug: string): NextlyError {
  return new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection was changed while this write waited for it, so nothing was written. Try again.",
    logContext: { reason: "definition-changed-while-held", slug },
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
