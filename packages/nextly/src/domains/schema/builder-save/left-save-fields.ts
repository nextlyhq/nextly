/**
 * The fields a Builder save the process left part-way holds. While its record stands unsettled on
 * MySQL, a schema statement of the save may have committed apart from the registry row that
 * describes it: the row still describing a field the tables have changed, or already describing one
 * they have not caught up with. A write that sets such a field is refused, naming it, with nothing
 * of it applied. Writes that set no such field go on, and reads are answered from the tables: this
 * process's running tables for the entity leave out each column the tables do not hold, so no
 * statement names one, until the record no longer stands, when they are the registry's again. A save
 * that changed the entity's own columns beyond its fields holds it whole: every write and every read
 * of it is refused, as each one reaches those columns.
 * Only the settle lifts it, at the next development start or save of the entity: the record stands
 * for every process on the database, whatever became of the save's own.
 *
 * Which fields: those of the registry row whose columns the tables do not hold as the row declares
 * them (`fieldsNotServedOf`), the main table and the translations table both, whichever road the
 * save took and in whichever order it wrote. Where that cannot be read, every field is held,
 * failing closed.
 *
 * What it costs: nothing in production, where Builder saves never run, and nothing on PostgreSQL or
 * SQLite, where a save's change commits whole or not at all. On MySQL outside production, one read
 * of the standing records at the entry of each write, which its transaction's checks use, and one
 * for a request that only reads, whatever it reads; outside a request, one per check, and one for
 * each transaction. A save that begins between a write's entry and its transaction is not seen; where one stands over the entity, the comparison, kept per record id once the schema
 * lock was free while it was made (a live save holds the lock, so its tables may still move; a
 * record standing with the lock free is a save no process runs).
 *
 * @module domains/schema/builder-save/left-save-fields
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { onceForRequestAbout } from "../../../auth/access/request-memo";
import { getService } from "../../../di/service-access";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isProductionRuntime } from "../../../shared/builder-refusal";
import { isMissingTable } from "../../field-groups/migration/session";
import { toSnakeCase } from "../field-rules";
import { readSchemaLockState } from "../pipeline/schema-lock";

import {
  readStandingSaves,
  savesStandingOver,
  type LeftSave,
  type ReadRow,
  type SaveInProgressKind,
} from "./save-in-progress";

/** The kinds of entity whose entries Nextly writes and reads. */
type EntryKind = Extract<SaveInProgressKind, "collection" | "single">;

/** The fields a left save holds, and the answer a write or read meets over them. */
interface HeldFields {
  /** The fields a write may not set. */
  readonly fields: ReadonlySet<string>;
  /**
   * Whether they are the comparison's: false where it could not be made (an unreadable record, a
   * transaction open before it was), so every field is held and the running tables are left as
   * they are, a read refused rather than answered from a shape not known.
   */
  readonly compared: boolean;
  /**
   * Whether the comparison found the whole entity held (`Unserved.whole`): every write is refused,
   * whatever it sets, the status alone included.
   */
  readonly whole: boolean;
  /** The refusal, naming the held fields and what settles them. */
  readonly refusal: NextlyError;
}

/** An entity's registry row, as far as its running tables are built from it. */
interface RegistryRow {
  tableName: string;
  fields: FieldDefinition[];
  status: boolean;
  localized: boolean;
}

/** What one record's comparison found, by field (`fieldsNotServedOf`). */
interface Unserved {
  fields: readonly string[];
  missing: readonly string[];
  /**
   * Whether the tables lack a column the entity's own shape needs beyond its fields (its status, a
   * translations table's own columns): the whole entity is held, its running tables left as they
   * are, and a read refused, since no narrowing of the fields answers it.
   */
  whole: boolean;
}

/**
 * What a record's comparison came to, by the id of the record it was made under: final once made
 * with the schema lock free before and after it, as the save behind a record no process runs
 * changes nothing more (a settle clears its record, so a later record has its own id). `busy`
 * where a schema change held the lock when last asked: its tables may still be moving, so nothing
 * is held over them and the next check outside a transaction asks again.
 */
const comparedById = new Map<
  string,
  { unserved: Unserved; final: true } | { busy: true }
>();

/**
 * The entities whose running tables this process has narrowed (`shapeRunningTables`), by kind and
 * slug, with the record and the missing fields they were narrowed for, and the table registered
 * then: another one in its place since (the definitions loaded again) is narrowed again.
 */
const narrowedBy = new Map<string, { shape: string; table: unknown }>();

/**
 * Refuses a write to an entry of `kind` `slug` that sets a field a left save holds: a key of
 * `data` naming it, as written or as its column (`toSnakeCase`); any write where the save holds the
 * whole entity. Nothing of the write has run.
 */
export async function refuseWriteOverLeftSave(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  data: Readonly<Record<string, unknown>>;
  /** The handle of a transaction the write already runs in (`heldFieldsOf`). */
  tx?: unknown;
}): Promise<void> {
  // At a write's entry, what stands is read afresh and kept for its transaction's checks.
  const held = await heldFieldsOf({ ...args, fresh: args.tx === undefined });
  if (held === undefined) return;
  if (held.whole) throw held.refusal;
  const named = (key: string) =>
    [...held.fields].some(
      field => field === key || toSnakeCase(field) === toSnakeCase(key)
    );
  if (Object.keys(args.data).some(named)) throw held.refusal;
}

/**
 * The keys of `values` a write sets: those whose value is not `undefined`, which a write leaves out,
 * so a column passed over sets no field.
 */
export function writtenKeys(
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

/**
 * Readies a read of the entries of `kind` `slug` while a left save stands: answered from the tables,
 * the running tables leaving out each column they do not hold (`heldFieldsOf`). Refused where the
 * comparison could not be made, as what the tables hold is then not known.
 */
export async function refuseReadOverLeftSave(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  const held = await heldFieldsOf(args);
  if (held !== undefined && !held.compared) throw held.refusal;
}

/**
 * The fields a save of `kind` `slug` the process left part-way holds, or undefined where none
 * stands, or where none can hold one (production, PostgreSQL, SQLite, a save that applies nothing
 * itself). Inside a transaction (`tx`) the record and the registry row are read on it, and a record
 * not compared yet holds every field, as the comparison reads the tables on other connections.
 */
async function heldFieldsOf(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  tx?: unknown;
  /** A write's entry: what the request kept is read again, not taken. */
  fresh?: boolean;
}): Promise<HeldFields | undefined> {
  if (isProductionRuntime()) return undefined;
  if (args.adapter.getCapabilities().dialect !== "mysql") return undefined;
  const joins = args.tx === undefined && args.adapter.inTransaction();
  // A write's entry outside any transaction reads what stands again, for itself and for every
  // check its transaction makes: a save begun since the request's last read is met here.
  if (args.fresh === true && !joins) delete keptForRequest().standing;
  // Not read where the request knows already that no record stands and nothing is narrowed.
  const known =
    args.fresh === true ? undefined : await keptForRequest().standing;
  if (known?.length === 0 && narrowedBy.size === 0) return undefined;
  // A check made inside a transaction it was not handed (a rule's own read, say) joins it, so
  // nothing it reads takes another connection while that one is held. Only what it found is
  // handed out: the refusal is thrown by the caller, past the join. A failure inside the join ends
  // the transaction it joined, which MySQL joins flat.
  if (joins) {
    return args.adapter.transaction(tx =>
      heldIn({ ...args, tx: tx.getDrizzle() })
    );
  }
  return heldIn(args);
}

/** What `heldFieldsOf` answers on MySQL outside production, read on `tx` where there is one. */
async function heldIn(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  tx?: unknown;
  fresh?: boolean;
}): Promise<HeldFields | undefined> {
  const standing = await applyingRecordsOf(args);
  if (standing === undefined) {
    await restoreRunningTables(args);
    return undefined;
  }
  const registry = await registryRowOf(args);
  if (registry === null) return undefined;
  const mine =
    standing.own === undefined
      ? undefined
      : await heldByOwnRecord(args, standing.own, registry);
  if (mine === "busy") return undefined;
  return heldOver(
    args,
    mine,
    await heldByFieldGroups(args, standing.groups, registry)
  );
}

/**
 * The records standing over the entity whose saves applied their own changes: undefined where none
 * does. A save made outside development leaves its files for `nextly migrate` and changes no table.
 */
async function applyingRecordsOf(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  tx?: unknown;
  fresh?: boolean;
}): Promise<
  | { own: ReadRow | undefined; groups: ReadonlyArray<{ slug: string }> }
  | undefined
> {
  const { own, fieldGroups } = await standingRecordsOf(args);
  const applying = (row: ReadRow | undefined): row is ReadRow =>
    row !== undefined && !("record" in row && row.record.applies === false);
  const groups = fieldGroups.filter(group => applying(group.row));
  if (!applying(own) && groups.length === 0) return undefined;
  return { own: applying(own) ? own : undefined, groups };
}

/**
 * What a write or read of the entity meets over the fields its own record and the field groups'
 * hold: undefined where they hold none. The refusal names the save behind it: the entity's own
 * where that holds a field, else the field group's, whose settle lifts it.
 */
function heldOver(
  args: { kind: EntryKind; slug: string },
  mine: HeldByOwn | undefined,
  embedding: EmbeddingFields
): HeldFields | undefined {
  // The whole entity held: no field of it is named, as what the save changed is not one of them.
  if (mine?.whole === true) {
    return {
      fields: new Set(mine.fields),
      compared: false,
      whole: true,
      refusal: heldWholeRefusal(args.kind, args.slug),
    };
  }
  const fields = [...new Set([...(mine?.fields ?? []), ...embedding.fields])];
  if (fields.length === 0) return undefined;
  const group = (mine?.fields.length ?? 0) > 0 ? undefined : embedding.group;
  return {
    fields: new Set(fields),
    whole: false,
    // A field group's save is not compared: the host's reads, which reach its tables, are refused.
    compared:
      (mine === undefined || mine.compared) && embedding.fields.length === 0,
    refusal:
      group === undefined
        ? heldFieldsRefusal(args.kind, args.slug, fields)
        : heldFieldsRefusal("fieldGroup", group, fields, {
            kind: args.kind,
            slug: args.slug,
          }),
  };
}

/** What the entity's own record holds, and whether it holds the whole entity (`HeldFields`). */
interface HeldByOwn {
  fields: readonly string[];
  compared: boolean;
  whole?: boolean;
}

/**
 * What the entity's own record holds: the fields the comparison finds, its running tables brought
 * to them; every field where its record cannot be read or nothing is known; `"busy"` where a schema
 * change holds the lock.
 */
async function heldByOwnRecord(
  args: {
    adapter: DrizzleAdapter;
    kind: EntryKind;
    slug: string;
    tx?: unknown;
  },
  own: ReadRow,
  registry: RegistryRow
): Promise<HeldByOwn | "busy"> {
  // A record that cannot be read could be any save's: every field is held, failing closed.
  if (!("record" in own)) {
    return { fields: namesOf(registry.fields), compared: false };
  }
  const unserved = await unservedOf(args, own.record, registry);
  if (unserved === "busy") return "busy";
  if (unserved === undefined || unserved.whole) {
    return {
      fields: namesOf(registry.fields),
      compared: false,
      whole: unserved?.whole === true,
    };
  }
  await shapeRunningTables(args, own.record.id, registry, unserved.missing);
  return { fields: unserved.fields, compared: true };
}

/** The entity's fields a field group's left save holds, and the first such field group. */
interface EmbeddingFields {
  fields: readonly string[];
  group: string | undefined;
}

const NO_EMBEDDING: EmbeddingFields = { fields: [], group: undefined };

/**
 * The entity's fields that hold a field group a save left part-way stands over, wherever in the
 * field they sit (a group's or a repeater's fields included). Not compared from the tables: each is
 * held whole while that save stands. None while a schema change holds the lock, as for its own.
 */
async function heldByFieldGroups(
  args: { adapter: DrizzleAdapter },
  groups: ReadonlyArray<{ slug: string }>,
  registry: RegistryRow
): Promise<EmbeddingFields> {
  if (groups.length === 0) return NO_EMBEDDING;
  const slugs = new Set(groups.map(group => group.slug));
  const held = registry.fields.flatMap(field => {
    const name = field.name;
    const group =
      typeof name === "string" ? embeddedGroup(field, slugs) : undefined;
    return typeof name === "string" && group !== undefined
      ? [{ name, group }]
      : [];
  });
  if (held.length === 0 || !(await lockFree(args.adapter))) {
    return NO_EMBEDDING;
  }
  return { fields: held.map(each => each.name), group: held[0]?.group };
}

/** The field group of `slugs` that `field`, or a field within it, holds: undefined where none. */
function embeddedGroup(
  field: unknown,
  slugs: ReadonlySet<string>
): string | undefined {
  if (typeof field !== "object" || field === null) return undefined;
  const named = field as {
    component?: unknown;
    components?: unknown;
    fields?: unknown;
  };
  const own = [
    named.component,
    ...(Array.isArray(named.components) ? named.components : []),
  ].find((slug): slug is string => typeof slug === "string" && slugs.has(slug));
  if (own !== undefined || !Array.isArray(named.fields)) return own;
  for (const child of named.fields) {
    const found = embeddedGroup(child, slugs);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * What the request has read of the records standing, kept with it (`onceForRequestAbout`): one read
 * answers every check the request makes, over any entity. Outside a request it keeps nothing, so
 * each check reads. A save that starts while the request runs is not seen by it.
 */
function keptForRequest(): { standing?: Promise<ReadRow[]> } {
  return onceForRequestAbout("builder-saves-left-standing", () => ({}));
}

/**
 * The records standing over the entity: what the request kept (a write's entry reads it again),
 * else read on the check's own transaction, once for it. A read that fails is never kept.
 */
async function standingRecordsOf(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  tx?: unknown;
  fresh?: boolean;
}): Promise<ReturnType<typeof savesStandingOver>> {
  const kept = keptForRequest();
  if (kept.standing === undefined || (args.fresh && args.tx !== undefined)) {
    if (typeof args.tx === "object" && args.tx !== null) {
      return savesStandingOver(
        await standingOnTransaction(args.adapter, args.tx),
        args.kind,
        args.slug
      );
    }
    kept.standing = standingOn(args.adapter, args.adapter.getDrizzle());
    kept.standing.catch(() => {
      delete kept.standing;
    });
  }
  return savesStandingOver(await kept.standing, args.kind, args.slug);
}

/**
 * The records standing as a check inside a transaction read them, by the transaction's handle: one
 * read for a transaction the request read nothing before, a batch's among them. Each transaction
 * has a handle of its own, so a later one never takes an earlier one's.
 */
const readOnTransaction = new WeakMap<object, Promise<ReadRow[]>>();

/** The records standing, read on `tx` once for it. A read that fails is not kept. */
function standingOnTransaction(
  adapter: DrizzleAdapter,
  tx: object
): Promise<ReadRow[]> {
  const kept = readOnTransaction.get(tx);
  if (kept !== undefined) return kept;
  const reading = standingOn(adapter, tx);
  readOnTransaction.set(tx, reading);
  reading.catch(() => {
    readOnTransaction.delete(tx);
  });
  return reading;
}

/** Every record standing, read on `db`: none where the database's meta table is not made yet. */
async function standingOn(
  adapter: DrizzleAdapter,
  db: unknown
): Promise<ReadRow[]> {
  const dialect = adapter.getCapabilities().dialect;
  try {
    return await readStandingSaves(db, dialect);
  } catch (error) {
    if (isMissingTable(error, dialect)) return [];
    throw error;
  }
}

/** The names of `fields`, those with one. */
function namesOf(fields: readonly FieldDefinition[]): string[] {
  return fields.flatMap(field =>
    typeof field.name === "string" ? [field.name] : []
  );
}

/**
 * Brings this process's running tables for the entity (the main table and its translations table,
 * in both caches the dispatcher keeps) to its registry row less the fields whose columns the
 * tables do not hold, once per record; with none missing, to the row as it is.
 */
async function shapeRunningTables(
  args: { adapter: DrizzleAdapter; kind: EntryKind; slug: string },
  recordId: string,
  registry: RegistryRow,
  missing: readonly string[]
): Promise<void> {
  const key = `${args.kind}:${args.slug}`;
  if (missing.length === 0) {
    await restoreRunningTables(args);
    return;
  }
  // Registered again where the record or the missing fields changed since the last narrowing, or
  // where something put another table in place of the one it registered.
  const shape = `${recordId}:${[...missing].sort().join(",")}`;
  const { getSchemaRegistryFromDI } = await import(
    "../../../dispatcher/helpers/di"
  );
  const running = () => getSchemaRegistryFromDI()?.getTable(registry.tableName);
  const narrowed = narrowedBy.get(key);
  if (narrowed?.shape === shape && narrowed.table === running()) return;
  const gone = new Set(missing);
  await registerRunningTables(
    args,
    {
      ...registry,
      fields: registry.fields.filter(
        field => typeof field.name !== "string" || !gone.has(field.name)
      ),
    },
    registry
  );
  narrowedBy.set(key, { shape, table: running() });
}

/** Puts back the registry's own running tables for an entity this process narrowed, if it did. */
async function restoreRunningTables(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  const key = `${args.kind}:${args.slug}`;
  if (!narrowedBy.has(key)) return;
  const registry = await registryRowOf(args);
  if (registry !== null) await registerRunningTables(args, registry);
  narrowedBy.delete(key);
}

/**
 * Registers the entity's running tables for `registry` as the shared registration builds them
 * (`registerEntityRuntimeTables`), in the adapter's cache and, for a collection, the reads' own.
 * Where they are those of `whole` with fields left out, and none of its translated fields is left,
 * that registration builds no translations table, so one of no field's column is registered here:
 * the one before it would go on naming columns the table does not hold.
 */
async function registerRunningTables(
  args: { adapter: DrizzleAdapter; kind: EntryKind; slug: string },
  registry: RegistryRow,
  whole?: RegistryRow
): Promise<void> {
  // Loaded only where a left save narrows or puts back a shape: never on an ordinary write.
  const [{ registerEntityRuntimeTables }, di] = await Promise.all([
    import("../../../di/register-runtime-tables"),
    import("../../../dispatcher/helpers/di"),
  ]);
  const schemas = di.getSchemaRegistryFromDI();
  const reads =
    args.kind === "collection" ? di.getCollectionsHandlerFromDI() : undefined;
  const register = (name: string, table: unknown) => {
    schemas?.registerDynamicSchema(name, table);
    reads?.refreshCollectionSchema(name, table);
  };
  const dialect = args.adapter.getCapabilities().dialect;
  registerEntityRuntimeTables(
    { registerDynamicSchema: register },
    { slug: args.slug, ...registry },
    dialect
  );
  if (whole === undefined || !(await leavesNoTranslation(whole, registry))) {
    return;
  }
  const { generateCompanionRuntimeSchema } = await import(
    "../services/runtime-schema-generator"
  );
  const { publishesPerLanguage } = await import(
    "../../i18n/per-language-storage"
  );
  const translations = `${whole.tableName}_locales`;
  register(
    translations,
    generateCompanionRuntimeSchema(translations, [], dialect, {
      // Its own columns stay: the status of each language where it has one.
      status: publishesPerLanguage(whole),
    }).table
  );
}

/** Whether `whole` has a column on its translations table and `narrowed`, less some fields, none. */
async function leavesNoTranslation(
  whole: RegistryRow,
  narrowed: RegistryRow
): Promise<boolean> {
  const [{ storesPerLanguage }, { hasTranslationColumn }] = await Promise.all([
    import("../../i18n/per-language-storage"),
    import("../../i18n/shared-structure"),
  ]);
  if (!storesPerLanguage(whole)) return false;
  const translates = (row: RegistryRow) =>
    row.fields.some(
      field =>
        typeof field.name === "string" &&
        hasTranslationColumn({ ...field, name: field.name }, true)
    );
  return translates(whole) && !translates(narrowed);
}

/**
 * The record's comparison: final from before (`comparedById`), or made where no transaction is open
 * with the schema lock free before and after it, and kept as final. `"busy"` where a schema change
 * holds the lock. Inside a transaction nothing is compared, as the tables would be read on other
 * connections: what was found before it opened, on the road's way in, is read instead
 * (`compareBeforeTransaction`). Undefined where nothing is known, which holds every field.
 */
async function unservedOf(
  args: { adapter: DrizzleAdapter; tx?: unknown },
  record: LeftSave,
  registry: RegistryRow
): Promise<Unserved | "busy" | undefined> {
  const known = comparedById.get(record.id);
  if (known !== undefined && "unserved" in known) return known.unserved;
  if (args.tx !== undefined) return known === undefined ? undefined : "busy";
  const busy = () => {
    comparedById.set(record.id, { busy: true });
    return "busy" as const;
  };
  if (!(await lockFree(args.adapter))) return busy();
  // Loaded only where a record stands: the comparison and the settle around it never are otherwise.
  const { fieldsNotServedOf } = await import("./settle-left-save");
  const found = await fieldsNotServedOf(args.adapter, record, registry);
  if (found === undefined) return undefined;
  // Taken while the lock was free throughout: a change that took it meanwhile may have moved them.
  if (!(await lockFree(args.adapter))) return busy();
  const unserved: Unserved = {
    fields: found.unserved.map(f => f.field),
    missing: found.unserved.filter(f => f.missing).map(f => f.field),
    whole: !found.shapeServed,
  };
  comparedById.set(record.id, { unserved, final: true });
  return unserved;
}

/** Whether no schema change holds the schema lock now. */
async function lockFree(adapter: DrizzleAdapter): Promise<boolean> {
  return (await readSchemaLockState(adapter)).state === "free";
}

/**
 * Compares a standing record's entity before a transaction that writes it opens, so the checks
 * inside it (`refuseWriteOverLeftSave` with `tx`) read what holds rather than holding every field.
 * Nothing where no record stands, or none can hold one.
 */
export async function compareBeforeTransaction(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  // A write's entry: read afresh, as the write's own check is.
  await heldFieldsOf({ ...args, fresh: true });
}

/** The entity's registry row, read on the write's transaction where it has one; null where none. */
async function registryRowOf(args: {
  kind: EntryKind;
  slug: string;
  tx?: unknown;
}): Promise<RegistryRow | null> {
  const row =
    args.kind === "single"
      ? await getService("singleRegistryService").getSingleBySlug(
          args.slug,
          args.tx
        )
      : await getService("collectionRegistryService").getCollectionBySlug(
          args.slug,
          args.tx
        );
  if (row === null || row === undefined) return null;
  const read = row as {
    tableName?: unknown;
    fields?: unknown;
    status?: unknown;
    localized?: unknown;
  };
  return typeof read.tableName === "string"
    ? {
        tableName: read.tableName,
        fields: Array.isArray(read.fields)
          ? (read.fields as FieldDefinition[])
          : [],
        status: read.status === true,
        localized: read.localized === true,
      }
    : null;
}

/**
 * The refusal of a write or read over `fields`, which a save of `kind` `slug` left part-way holds:
 * naming them and what settles them. Where the save is a field group's and the fields are those of
 * another entity that embed it (`host`), it names them as that entity's. Its CLI code is
 * `BUILDER_SAVE_FIELD_UNSETTLED`.
 */
export function heldFieldsRefusal(
  kind: SaveInProgressKind,
  slug: string,
  fields: readonly string[],
  host?: { kind: EntryKind; slug: string }
): NextlyError {
  const kindName = kind === "fieldGroup" ? "field group" : kind;
  const names = fields.map(name => `"${name}"`).join(", ");
  const one = fields.length === 1;
  const changed =
    host === undefined
      ? `it changed ${one ? "the field" : "the fields"} ${names} without recording ${one ? "it" : "them"} yet`
      : `it changed what ${one ? "the field" : "the fields"} ${names} of the ${host.kind} "${host.slug}" ${one ? "holds" : "hold"} without recording it yet`;
  return new NextlyError({
    code: "BUILDER_SAVE_FIELD_UNSETTLED",
    publicMessage: `A Builder save of the ${kindName} "${slug}" was left part-way, and ${changed}. A write that sets ${one ? "it" : "one of them"}, or a read that needs ${one ? "it" : "them"}, is refused until the save is settled: the next development start (\`next dev\`), or the next save of this ${kindName} in the Schema Builder, settles it. Then try again.`,
    logContext: {
      reason: "builder-save-field-unsettled",
      kind,
      slug,
      fields: [...fields],
      ...(host === undefined ? {} : { host: `${host.kind}:${host.slug}` }),
    },
  });
}

/**
 * The refusal of any write or read of an entity a save of it, left part-way, holds whole: the save
 * changed the entity's own columns beyond its fields (its status, its translations table's own), so
 * no field answers what it holds.
 */
function heldWholeRefusal(kind: EntryKind, slug: string): NextlyError {
  return new NextlyError({
    code: "BUILDER_SAVE_FIELD_UNSETTLED",
    publicMessage: `A Builder save of the ${kind} "${slug}" was left part-way, and it changed the ${kind}'s own columns, beyond its fields, without recording it yet. Every write and read of the ${kind} is refused until the save is settled: the next development start (\`next dev\`), or the next save of this ${kind} in the Schema Builder, settles it. Then try again.`,
    logContext: {
      reason: "builder-save-entity-unsettled",
      kind,
      slug,
    },
  });
}
