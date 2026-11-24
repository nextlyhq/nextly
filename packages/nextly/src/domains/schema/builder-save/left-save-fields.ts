/**
 * The fields a Builder save the process left part-way holds. While its record stands unsettled on
 * MySQL, a schema statement of the save may have committed apart from the registry row that
 * describes it: the row still describing a field the tables have changed, or already describing one
 * they have not caught up with. A write that sets such a field is refused, naming it, with nothing
 * of it applied. Writes that set no such field go on, and reads are answered from the tables: this
 * process's running tables for the entity leave out each column the tables do not hold, so no
 * statement names one, until the record no longer stands, when they are the registry's again.
 * Only the settle lifts it, at the next development start or save of the entity: the record stands
 * for every process on the database, whatever became of the save's own.
 *
 * Which fields: those of the registry row whose columns the tables do not hold as the row declares
 * them (`fieldsNotServedOf`), the main table and the translations table both, whichever road the
 * save took and in whichever order it wrote. Where that cannot be read, every field is held,
 * failing closed.
 *
 * What it costs: nothing in production, where Builder saves never run, and nothing on PostgreSQL or
 * SQLite, where a save's change commits whole or not at all. On MySQL in development, one
 * primary-key read of the entity's record per write or read; where one stands, the comparison,
 * kept per record id once the schema lock was free while it was made (a live save holds the lock,
 * so its tables may still move; a record standing with the lock free is a save no process runs).
 *
 * @module domains/schema/builder-save/left-save-fields
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../../../di/service-access";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isProductionRuntime } from "../../../shared/builder-refusal";
import { isMissingTable } from "../../field-groups/migration/session";
import { toSnakeCase } from "../field-rules";
import { readSchemaLockState } from "../pipeline/schema-lock";

import {
  readSaveInProgressOf,
  type LeftSave,
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
}

/**
 * Each comparison, by the id of the record it was made under: the save behind a record no process
 * runs changes nothing more, and a settle clears its record, so a later record has its own id.
 */
const comparedById = new Map<string, Unserved>();

/**
 * The entities whose running tables this process has narrowed (`shapeRunningTables`), by kind and
 * slug, with the id of the record they were narrowed under.
 */
const narrowedBy = new Map<string, string>();

/**
 * Refuses a write to an entry of `kind` `slug` that sets a field a left save holds: a key of
 * `data` naming it, as written or as its column (`toSnakeCase`). Nothing of the write has run.
 */
export async function refuseWriteOverLeftSave(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  data: Readonly<Record<string, unknown>>;
  /** The handle of a transaction the write already runs in (`heldFieldsOf`). */
  tx?: unknown;
}): Promise<void> {
  const held = await heldFieldsOf(args);
  if (held === undefined) return;
  const named = (key: string) =>
    [...held.fields].some(
      field => field === key || toSnakeCase(field) === toSnakeCase(key)
    );
  if (Object.keys(args.data).some(named)) throw held.refusal;
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
}): Promise<HeldFields | undefined> {
  if (isProductionRuntime()) return undefined;
  if (args.adapter.getCapabilities().dialect !== "mysql") return undefined;
  const row = await standingRecordOf(args);
  // A save made outside development leaves its files for `nextly migrate` and changes no table.
  if (row === undefined || ("record" in row && row.record.applies === false)) {
    await restoreRunningTables(args);
    return undefined;
  }
  const registry = await registryRowOf(args);
  if (registry === null) return undefined;
  // A record that cannot be read could be any save's: every field is held, failing closed.
  const record = "record" in row ? row.record : undefined;
  const unserved =
    record === undefined
      ? undefined
      : await unservedOf(args, record, registry.fields);
  if (record !== undefined && unserved !== undefined) {
    await shapeRunningTables(args, record.id, registry, unserved.missing);
  }
  return heldOf(args, unserved?.fields ?? namesOf(registry.fields), unserved);
}

/**
 * The record standing for the entity, read on the write's transaction where it has one: undefined
 * where none stands, a database whose meta table is not made yet included.
 */
async function standingRecordOf(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
  tx?: unknown;
}): Promise<Awaited<ReturnType<typeof readSaveInProgressOf>>> {
  const dialect = args.adapter.getCapabilities().dialect;
  try {
    return await readSaveInProgressOf(
      args.tx ?? args.adapter.getDrizzle(),
      dialect,
      args.kind,
      args.slug
    );
  } catch (error) {
    if (isMissingTable(error, dialect)) return undefined;
    throw error;
  }
}

/** The answer over `fields`, as compared (`unserved`) or held whole; undefined where none is held. */
function heldOf(
  args: { kind: EntryKind; slug: string },
  fields: readonly string[],
  unserved: Unserved | undefined
): HeldFields | undefined {
  if (fields.length === 0) return undefined;
  return {
    fields: new Set(fields),
    compared: unserved !== undefined,
    refusal: heldFieldsRefusal(args.kind, args.slug, fields),
  };
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
  if (narrowedBy.get(key) === recordId) return;
  const gone = new Set(missing);
  await registerRunningTables(args, {
    ...registry,
    fields: registry.fields.filter(
      field => typeof field.name !== "string" || !gone.has(field.name)
    ),
  });
  narrowedBy.set(key, recordId);
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
 */
async function registerRunningTables(
  args: { adapter: DrizzleAdapter; kind: EntryKind; slug: string },
  registry: RegistryRow
): Promise<void> {
  // Loaded only where a left save narrows or puts back a shape: never on an ordinary write.
  const [{ registerEntityRuntimeTables }, di] = await Promise.all([
    import("../../../di/register-runtime-tables"),
    import("../../../dispatcher/helpers/di"),
  ]);
  const schemas = di.getSchemaRegistryFromDI();
  const reads =
    args.kind === "collection" ? di.getCollectionsHandlerFromDI() : undefined;
  registerEntityRuntimeTables(
    {
      registerDynamicSchema: (name, table) => {
        schemas?.registerDynamicSchema(name, table);
        reads?.refreshCollectionSchema(name, table);
      },
    },
    { slug: args.slug, ...registry },
    args.adapter.getCapabilities().dialect
  );
}

/**
 * The record's comparison: kept from before (`comparedById`), or made where no transaction is open
 * and kept where the schema lock was free. Undefined where it cannot be made.
 */
async function unservedOf(
  args: { adapter: DrizzleAdapter; tx?: unknown },
  record: LeftSave,
  registryFields: readonly unknown[]
): Promise<Unserved | undefined> {
  const known = comparedById.get(record.id);
  if (known !== undefined) return known;
  if (args.tx !== undefined) return undefined;
  const free = (await readSchemaLockState(args.adapter)).state === "free";
  // Loaded only where a record stands: the comparison and the settle around it never are otherwise.
  const { fieldsNotServedOf } = await import("./settle-left-save");
  const found = await fieldsNotServedOf(args.adapter, record, registryFields);
  if (found === undefined) return undefined;
  const unserved = {
    fields: found.map(f => f.field),
    missing: found.filter(f => f.missing).map(f => f.field),
  };
  if (free) comparedById.set(record.id, unserved);
  return unserved;
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
 * naming them and what settles them. Its CLI code is `BUILDER_SAVE_FIELD_UNSETTLED`.
 */
export function heldFieldsRefusal(
  kind: SaveInProgressKind,
  slug: string,
  fields: readonly string[]
): NextlyError {
  const kindName = kind === "fieldGroup" ? "field group" : kind;
  const names = fields.map(name => `"${name}"`).join(", ");
  const one = fields.length === 1;
  return new NextlyError({
    code: "BUILDER_SAVE_FIELD_UNSETTLED",
    publicMessage: `A Builder save of the ${kindName} "${slug}" was left part-way, and it changed ${one ? "the field" : "the fields"} ${names} without recording ${one ? "it" : "them"} yet. A write that sets ${one ? "it" : "one of them"}, or a read that needs ${one ? "it" : "them"}, is refused until the save is settled: the next development start (\`next dev\`), or the next save of this ${kindName} in the Schema Builder, settles it. Then try again.`,
    logContext: {
      reason: "builder-save-field-unsettled",
      kind,
      slug,
      fields: [...fields],
    },
  });
}
