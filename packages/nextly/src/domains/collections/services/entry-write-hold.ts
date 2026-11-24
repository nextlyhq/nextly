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
  ENTITY_HOLD_WAIT_MS,
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
  /** The fields the write names in what it stores: those it sets, and defaults nobody changed. */
  readonly namesFields: readonly string[];
  readonly insertsOnly?: true;
  /** Whether the write sets the entry's publishing state (`status`, the lifecycle's own column). */
  readonly setsStatus: boolean;
  /** Whether the collection's Draft/Published lifecycle was on in the row loaded. */
  readonly lifecycle: boolean;
  /** Whether the collection was translated in the row loaded. */
  readonly localized: boolean;
  /** The tries the write is made in, which its hold tells and asks. */
  readonly tries?: HeldTries;
}

/** What a write's hold tells its tries, and asks of them (`WriteTries`). */
export interface HeldTries {
  /** Told, under the hold, whether the definition has changed since the write loaded it. */
  compared(changed: boolean): void;
  /** What is left of `whole`, the time the write may wait for its hold over all its tries. */
  waitLeft(whole: number): number;
  /** Whether the write can be made again, so refusing it as made earlier costs it nothing. */
  readonly remakes: boolean;
}

/** How a write is made from the row it loads (`loadedRegistryRowOf`). */
export interface LoadedRegistryRowOptions {
  /** A create, or a batch of them. */
  insertsOnly?: boolean;
  /** The fields `data` holds only as their own defaults, put there by the write itself. */
  untouchedDefaults?: ReadonlySet<string>;
  /** The tries the write is made in. */
  tries?: HeldTries;
}

/** An entry's data, or a batch's items, each an entry's data. */
type WrittenData =
  | Readonly<Record<string, unknown>>
  | readonly Readonly<Record<string, unknown>>[];

/**
 * The registry row `row` (a collection's, as `getCollection` answers it) as a write made from it
 * holds it: its id, its schema version, its definition's fields, and those of them that `data`
 * (an entry's data as its hooks left it, or a batch's items) names, of which it sets all but the
 * defaults nobody changed. With `insertsOnly`, for a create. Undefined where the row carries no id,
 * so nothing is compared.
 */
export function loadedRegistryRowOf(
  row: unknown,
  data?: WrittenData,
  options?: LoadedRegistryRowOptions
): LoadedRegistryRow | undefined {
  const { id, schemaVersion, fields, status, localized } = (row ?? {}) as {
    id?: unknown;
    schemaVersion?: unknown;
    fields?: unknown;
    status?: unknown;
    localized?: unknown;
  };
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const version = Number(schemaVersion);
  const stored = storedFieldsOf(fields);
  const names = stored.map(field => field.name);
  const written = data === undefined ? [] : names.filter(setBy(data));
  return {
    id: String(id),
    schemaVersion: Number.isFinite(version) ? version : undefined,
    fields: names,
    stored,
    setsFields: written.filter(
      name => options?.untouchedDefaults?.has(name) !== true
    ),
    namesFields: written,
    setsStatus: data !== undefined && setBy(data)("status"),
    lifecycle: isOn(status),
    localized: isOn(localized),
    ...(options?.insertsOnly === true ? { insertsOnly: true as const } : {}),
    ...(options?.tries === undefined ? {} : { tries: options.tries }),
  };
}

/** How long a write made from `loaded` may wait for its hold: one time over all its tries. */
export function holdWaitOf(
  loaded: LoadedRegistryRow | undefined,
  /** The whole of that time: on SQLite, the database's busy timeout. */
  whole = ENTITY_HOLD_WAIT_MS
): number {
  return loaded?.tries?.waitLeft(whole) ?? whole;
}

/**
 * The fields of the definition `was` was made from that `now` no longer has, or keeps by name but
 * stores differently, and the fields `now` has that it did not.
 */
export function fieldsMoved(
  was: LoadedRegistryRow,
  now: LoadedRegistryRow,
  dialect: SupportedDialect
): { gone: ReadonlySet<string>; added: ReadonlySet<string> } {
  const different = storedDifferently(was, now.stored, dialect);
  const kept = new Set(now.fields.filter(name => !different.has(name)));
  const before = new Set(was.fields);
  return {
    gone: new Set(was.fields.filter(name => !kept.has(name))),
    added: new Set(now.fields.filter(name => !before.has(name))),
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
  const waits = { ...options, waitMs: holdWaitOf(loaded) };
  if (!(await sharedForWrite(tx, entity, adapter, dialect, waits))) {
    return false;
  }
  const row = await heldRegistryRow(tx, entity, holder, dialect, waits.waitMs);
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
  options: { sharedInProcess?: boolean; whenHeld?: WhenHeld; waitMs: number }
): Promise<boolean> {
  if (dialect === "postgresql") {
    const rows: RowsOn = query => tx.queryStatement(query);
    return sharedOnPostgres(rows, entity, options);
  }
  // MySQL's share is its registry row's own read (`heldRegistryRow`).
  if (dialect === "sqlite" && options.sharedInProcess !== true) {
    refuseWhileHeldInProcess(adapter, entity);
  }
  return true;
}

/** A write's share of `entity` on PostgreSQL, where a save holds it as `whenHeld` says. */
async function sharedOnPostgres(
  rows: RowsOn,
  entity: EntityRef,
  { whenHeld, waitMs }: { whenHeld?: WhenHeld; waitMs: number }
): Promise<boolean> {
  if (whenHeld === "leave") return tryShareEntityOnPostgres(rows, entity);
  if (whenHeld === "refuse") await refuseUnlessSharedOnPostgres(rows, entity);
  else await shareEntityOnPostgres(rows, entity, waitMs);
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
  dialect: SupportedDialect,
  waitMs: number
): Promise<HeldRegistryRow | null | undefined> {
  return dialect === "mysql"
    ? heldRegistryRowOnMysql(tx, entity, holder, waitMs)
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

/** A registry row as held, as it is compared: whether it is there, its id and its version. */
interface HeldRow {
  readonly present: boolean;
  readonly id: string | undefined;
  readonly version: number | undefined;
}

/** A row read, as `refuseUnlessSameRow` compares it. */
function heldRowOf(row: HeldRegistryRow | null | undefined): HeldRow {
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
  holder: CollectionHolder,
  waitMs: number
): Promise<{ id: unknown; schemaVersion: unknown } | undefined> {
  const { existing, ids, versions } = await holder.holdCollectionsIn(
    tx,
    [entity.slug],
    "share",
    { waitMs }
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
 * (its schema version moved), it is compared with the definition held (`refuseMadeFromEarlier`).
 * Nothing of the write has run.
 */
async function refuseChanged(
  tx: TransactionContext,
  entity: EntityRef,
  loaded: LoadedRegistryRow,
  dialect: SupportedDialect,
  held: HeldRow
): Promise<void> {
  if (refuseUnlessSameRow(entity, loaded, held)) {
    const row = await tx.selectOne<HeldDefinitionRow>("dynamic_collections", {
      columns: DEFINITION_COLUMNS,
      where: { and: [{ column: "slug", op: "=", value: entity.slug }] },
    });
    refuseMadeFromEarlier(entity, loaded, heldDefinitionOf(row), dialect);
  }
  loaded.tries?.compared(false);
}

/**
 * On MySQL, a write on a transaction its caller opened and read in first (its snapshot older than
 * the hold) reads its collection's definition from that snapshot, whatever the hold then found: so
 * the definition the write was made from (`loaded`) is compared with the one that stands now,
 * read once for the transaction and locked, past the snapshot (`currentRow`). Elsewhere a
 * transaction's read is of the latest commit, and the write holds before it reads.
 */
export async function refuseOnEarlierSnapshot(
  tx: TransactionContext,
  entity: EntityRef,
  adapter: HoldingAdapter,
  loaded: LoadedRegistryRow | undefined
): Promise<void> {
  if (adapter.getCapabilities().dialect !== "mysql" || loaded === undefined) {
    return;
  }
  const current = await currentRow(tx, entity);
  if (!refuseUnlessSameRow(entity, loaded, heldRowOf(current))) return;
  refuseMadeFromEarlier(entity, loaded, heldDefinitionOf(current), "mysql");
}

/**
 * Whether the registry row `held` is the row `loaded` is made for, with its definition not yet
 * compared: refused where it is gone, or another row was made under its slug while the write
 * waited, with nothing of the write run. False where the same row's definition has not changed.
 */
function refuseUnlessSameRow(
  entity: EntityRef,
  loaded: LoadedRegistryRow,
  held: HeldRow
): boolean {
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
  return (
    loaded.schemaVersion !== undefined && held.version !== loaded.schemaVersion
  );
}

/**
 * Refuses a write made from `loaded`, a definition a save changed (`held`): a field the write sets
 * that the held definition no longer has, or keeps by name but stores differently
 * (`fieldsStoredDifferently`), is refused naming it; so is a write that reads the entry as it
 * stands, made from a definition with a field that is gone or stored differently, as one made for a
 * definition that changed (`COLLECTION_BEING_CHANGED`), since its read names that field's column.
 * A create reads no entry first and writes only the columns its data names, so one that cannot be
 * made again goes on where none of those changed; one that can is made again like any other write,
 * since it reads back what it wrote through the tables this process built from the earlier
 * definition. A lifecycle that came or went, or translation, changes what every write writes or
 * reads; a write that sets the status of a lifecycle that went is refused naming it, as one that
 * sets a removed field is.
 *
 * A write refused as made for a definition that changed has its tries told: one that can be
 * made again, from what its hooks left, is (`WriteTries`). A field it sets is named instead, since
 * no try could write it.
 */
function refuseMadeFromEarlier(
  entity: EntityRef,
  loaded: LoadedRegistryRow,
  held: HeldDefinition,
  dialect: SupportedDialect
): void {
  // Made again from the definition as it stands, however it is refused: the rows this process
  // keeps of it are cleared, so a retry reads it rather than the one the write was made from.
  clearRegistryRowCache();
  const set = [
    ...setFieldsNotAsHeld(loaded, held.fields, dialect),
    ...statusNotAsHeld(loaded, held),
  ];
  if (set.length > 0) throw setFieldsChangedWhileHeld(entity.slug, set);
  if (
    loaded.lifecycle === held.lifecycle &&
    loaded.localized === held.localized
  ) {
    const goesOn =
      loaded.insertsOnly === true && loaded.tries?.remakes !== true;
    const reads = goesOn ? loaded.namesFields : loaded.fields;
    if (madeFromWhatHolds(reads, loaded, held.fields, dialect)) return;
  }
  loaded.tries?.compared(true);
  throw changedWhileHeld(entity.slug);
}

/** The columns a held definition is read from (`HeldDefinition`). */
const DEFINITION_COLUMNS = ["fields", "status", "localized"];

/** What those columns hold. */
interface HeldDefinitionRow {
  fields: unknown;
  status: unknown;
  localized: unknown;
}

/**
 * A definition as held: its fields as the row stores them, and whether its lifecycle is on and it is
 * translated, which decide the columns an entry is kept in beside its fields'.
 */
interface HeldDefinition {
  readonly fields: readonly FieldDefinition[];
  readonly lifecycle: boolean;
  readonly localized: boolean;
}

/** The definition `row` holds, or none of its fields where there is no row. */
function heldDefinitionOf(
  row: HeldDefinitionRow | null | undefined
): HeldDefinition {
  return {
    fields: storedFieldsOf(row?.fields),
    lifecycle: isOn(row?.status),
    localized: isOn(row?.localized),
  };
}

/** Whether a registry flag is on, as any database spells it. */
function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * The registry row as it stands, with its definition, read with a locking read (MySQL: the latest
 * commit, whatever the transaction's snapshot) once for a transaction and entity.
 */
function currentRow(
  tx: TransactionContext,
  entity: EntityRef
): Promise<(HeldRegistryRow & HeldDefinitionRow) | null> {
  let rows = currentIn.get(tx);
  if (rows === undefined) {
    rows = new Map();
    currentIn.set(tx, rows);
  }
  const key = entityHoldKey(entity);
  let reading = rows.get(key);
  if (reading === undefined) {
    reading = tx.selectOne<HeldRegistryRow & HeldDefinitionRow>(
      "dynamic_collections",
      {
        columns: ["id", "schema_version", ...DEFINITION_COLUMNS],
        where: { and: [{ column: "slug", op: "=", value: entity.slug }] },
        forShare: true,
      }
    );
    rows.set(key, reading);
  }
  return reading;
}

/** The current rows each open transaction has read (`currentRow`), by entity. */
const currentIn = new WeakMap<
  TransactionContext,
  Map<string, Promise<(HeldRegistryRow & HeldDefinitionRow) | null>>
>();

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

/** The entry's status, where a write sets it and the lifecycle it belongs to is gone (`held`). */
function statusNotAsHeld(
  loaded: LoadedRegistryRow,
  held: HeldDefinition
): SetField[] {
  return loaded.setsStatus && loaded.lifecycle && !held.lifecycle
    ? [{ name: "status", was: "removed" }]
    : [];
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
 * Whether the fields a write names (`reads`: all its definition's where it reads the entry first,
 * those it writes where it inserts) are there as they were. One that was taken out, or is stored
 * differently, is not.
 */
function madeFromWhatHolds(
  reads: readonly string[],
  loaded: LoadedRegistryRow,
  held: readonly FieldDefinition[],
  dialect: SupportedDialect
): boolean {
  const names = new Set(held.map(field => field.name));
  if (reads.some(name => !names.has(name))) return false;
  const different = storedDifferently(loaded, held, dialect);
  return !reads.some(name => different.has(name));
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
