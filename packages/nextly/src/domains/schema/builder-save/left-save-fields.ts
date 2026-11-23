/**
 * The fields a Builder save the process left part-way holds. While its record stands unsettled on
 * MySQL, a schema statement of the save may have committed apart from the registry row that
 * describes it: the row still describing a field the tables have changed, or already describing one
 * they have not caught up with. A write that sets such a field is refused, naming it, with nothing
 * of it applied, and a read that needs a column the tables do not hold under the registry's name
 * gets the same answer, never a database error. Writes that set no such field go on. Only the
 * settle lifts it, at the next development start or save of the entity: the record stands for every
 * process on the database, whatever became of the save's own.
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
import { isProductionRuntime } from "../../../shared/builder-refusal";
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
  /** Of them, those with a column the tables do not hold at all, which a read would select. */
  readonly missing: ReadonlySet<string>;
  /** The refusal, naming the held fields and what settles them. */
  readonly refusal: NextlyError;
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
 * Refuses a read of the entries of `kind` `slug` while a left save holds a field whose column the
 * tables do not hold at all: the read would select it.
 */
export async function refuseReadOverLeftSave(args: {
  adapter: DrizzleAdapter;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  const held = await heldFieldsOf(args);
  if (held !== undefined && held.missing.size > 0) throw held.refusal;
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
  const dialect = args.adapter.getCapabilities().dialect;
  if (dialect !== "mysql") return undefined;
  const row = await readSaveInProgressOf(
    args.tx ?? args.adapter.getDrizzle(),
    dialect,
    args.kind,
    args.slug
  );
  if (row === undefined) return undefined;
  // A save made outside development leaves its files for `nextly migrate` and changes no table.
  if ("record" in row && row.record.applies === false) return undefined;
  const registryFields = await registryFieldsOf(args);
  const every = registryFields.flatMap(field => {
    const name = (field as { name?: unknown } | null)?.name;
    return typeof name === "string" ? [name] : [];
  });
  // A record that cannot be read could be any save's: every field is held, failing closed.
  const unserved =
    "record" in row
      ? await unservedOf(args, row.record, registryFields)
      : undefined;
  const { fields, missing } = unserved ?? { fields: every, missing: every };
  if (fields.length === 0) return undefined;
  return {
    fields: new Set(fields),
    missing: new Set(missing),
    refusal: heldFieldsRefusal(args.kind, args.slug, fields),
  };
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

/** The entity's registry row's fields, read on the write's transaction where it has one. */
async function registryFieldsOf(args: {
  kind: EntryKind;
  slug: string;
  tx?: unknown;
}): Promise<readonly unknown[]> {
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
  const fields: unknown = row?.fields;
  return Array.isArray(fields) ? fields : [];
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
  return NextlyError.conflict({
    reason: "state",
    message: `A Builder save of the ${kindName} "${slug}" was left part-way, and it changed ${one ? "the field" : "the fields"} ${names} without recording ${one ? "it" : "them"} yet. A write that sets ${one ? "it" : "one of them"}, or a read that needs ${one ? "it" : "them"}, is refused until the save is settled: the next development start (\`next dev\`), or the next save of this ${kindName} in the Schema Builder, settles it. Then try again.`,
    logContext: {
      reason: "builder-save-field-unsettled",
      kind,
      slug,
      fields: [...fields],
    },
  });
}
