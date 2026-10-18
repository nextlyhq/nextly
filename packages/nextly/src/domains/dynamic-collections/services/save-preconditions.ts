/**
 * What a collection's existing entries must satisfy before a schema save changes its table.
 *
 * A database refuses some changes because of the rows a table holds, and finds out only part-way
 * through a migration: a unique index over values that repeat, or a column narrowed below a value
 * it holds. MySQL commits each schema statement as it runs, so by then the statements before the
 * refused one have been applied. These are asked of the live table first, on every dialect so the
 * refusal reads the same everywhere, and a save that would fail is refused naming the field and
 * the entries in the way, with nothing changed. (A field made required over entries that hold no
 * value, and a required field added with nothing to give existing entries, are refused by the ALTER
 * generator, which already reads the live table for them.)
 *
 * @module domains/dynamic-collections/services/save-preconditions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ValidationPublicData } from "../../../errors/public-data";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  getColumnDescriptor,
  isTextStorageKind,
} from "../../schema/services/field-column-descriptor";

type Refusal = ValidationPublicData["errors"][number];

/**
 * One refusal: what the caller is told, and what only the log may hold. A field's stored values
 * can be hidden from someone who may still edit the collection's schema, so a value read from the
 * table never reaches the public error.
 */
export interface SaveRefusal {
  error: Refusal;
  logContext?: Record<string, unknown>;
}

interface PreconditionAdapter {
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
}

function quote(dialect: SupportedDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** A value as the refusal shows it: quoted text, so an empty one is visible. */
function shown(value: unknown): string {
  return `'${String(value)}'`;
}

function refused(error: Refusal, logContext?: Record<string, unknown>) {
  return { error, ...(logContext ? { logContext } : {}) };
}

function entries(count: number): string {
  return count === 1 ? "1 entry" : `${count} entries`;
}

/**
 * The refusals for a collection save that changes `tableName` from `oldFields` to `newFields`, one
 * per field whose change the entries cannot take. Empty when the save can apply.
 *
 * @param addedColumnBackfill - The value an added column gives existing rows (the ALTER
 *   generator's answer), or null when they get NULL.
 */
export async function refusalsForCollectionSave(args: {
  adapter: PreconditionAdapter;
  dialect: SupportedDialect;
  tableName: string;
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** A renamed field, which keeps its column and its values. */
  rename?: { from: FieldDefinition; to: FieldDefinition } | null;
  addedColumnBackfill: (field: FieldDefinition) => string | null;
  /**
   * The columns the live table has. Outside development a save writes its migration without
   * running it, so the registry can name a field whose column is still to come; such a field has
   * no entries to check yet, and reading its column would fail.
   */
  presentColumns: ReadonlySet<string>;
}): Promise<SaveRefusal[]> {
  const { adapter, dialect } = args;
  const table = quote(dialect, args.tableName);
  const before = new Map(args.oldFields.map(f => [f.name, f]));
  const previousOf = (field: FieldDefinition) =>
    args.rename?.to.name === field.name
      ? args.rename.from
      : before.get(field.name);
  let rowCount: number | undefined;
  const rows = async () => {
    rowCount ??= Number(
      (
        await adapter.executeQuery<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM ${table}`
        )
      )[0]?.n ?? 0
    );
    return rowCount;
  };

  const refusals: SaveRefusal[] = [];
  for (const field of args.newFields) {
    const column = getColumnDescriptor(field, dialect, "collection");
    if (!column) continue;
    const previous = previousOf(field);
    // A column still to be deployed holds no entries, so nothing can be in the way yet.
    if (previous !== undefined && !args.presentColumns.has(column.name))
      continue;
    const col = quote(dialect, column.name);
    const refusal =
      field.unique === true && previous?.unique !== true
        ? await uniqueRefusal({ field, previous, col })
        : await lengthRefusal({ field, previous, col, length: column.length });
    if (refusal) refusals.push(refusal);
  }
  return refusals;

  async function uniqueRefusal(at: {
    field: FieldDefinition;
    previous: FieldDefinition | undefined;
    col: string;
  }): Promise<SaveRefusal | undefined> {
    const path = `fields.${at.field.name}`;
    if (at.previous === undefined) {
      // A new column gives every existing entry the same value, or NULL, which repeats freely.
      const backfill = args.addedColumnBackfill(at.field);
      const count = backfill === null ? 0 : await rows();
      // The value an added column gives every entry is the field's own default, not a stored one,
      // so the message can name it.
      return count > 1
        ? refused({
            path,
            code: "UNIQUE_OVER_DUPLICATES",
            message:
              `${entries(count)} would share the value ${backfill} for ${at.field.name}, which must be unique. ` +
              `Add the field without Unique, give the existing entries their own values, then turn Unique on.`,
          })
        : undefined;
    }
    const [repeat] = await adapter.executeQuery<{
      value: unknown;
      n: number | string;
    }>(
      `SELECT ${at.col} AS value, COUNT(*) AS n FROM ${table} WHERE ${at.col} IS NOT NULL ` +
        `GROUP BY ${at.col} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT 1`
    );
    // The repeated value is stored content, so it is logged and left out of the message.
    return repeat
      ? refused(
          {
            path,
            code: "UNIQUE_OVER_DUPLICATES",
            message:
              `${entries(Number(repeat.n))} share a value for ${at.field.name}, which must be unique. ` +
              `Give them their own values first, then turn Unique on.`,
          },
          { field: at.field.name, repeatedValue: shown(repeat.value) }
        )
      : undefined;
  }

  async function lengthRefusal(at: {
    field: FieldDefinition;
    previous: FieldDefinition | undefined;
    col: string;
    length: number | undefined;
  }): Promise<SaveRefusal | undefined> {
    if (!narrowsText(at.previous, at.length)) return undefined;
    const chars = dialect === "mysql" ? "CHAR_LENGTH" : "LENGTH";
    const [longer] = await adapter.executeQuery<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${chars}(${at.col}) > ${at.length}`
    );
    const count = Number(longer?.n ?? 0);
    return count > 0
      ? refused({
          path: `fields.${at.field.name}`,
          code: "LENGTH_BELOW_VALUES",
          message:
            `${entries(count)} ${count === 1 ? "holds" : "hold"} a ${at.field.name} longer than ${at.length} characters, the new length. ` +
            `Shorten those values first, or keep the longer length.`,
        })
      : undefined;
  }

  /** Whether a text column the field already had is given a shorter bound than it had. */
  function narrowsText(
    previous: FieldDefinition | undefined,
    length: number | undefined
  ): length is number {
    if (previous === undefined || length === undefined) return false;
    const before = getColumnDescriptor(previous, dialect, "collection");
    if (!before || !isTextStorageKind(before.kind)) return false;
    return before.length === undefined || before.length > length;
  }
}
