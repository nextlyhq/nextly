/**
 * What a collection's existing entries must satisfy before a schema save changes its table.
 *
 * A database refuses some changes because of the rows a table holds, and finds out only part-way
 * through a migration: a unique index over values that repeat, or a column narrowed below a value
 * it holds. MySQL commits each schema statement as it runs, so by then the statements before the
 * refused one have been applied. These are asked of the live table first, on every dialect so the
 * refusal reads the same everywhere, and a save that would fail is refused naming the field and
 * the entries in the way, with nothing changed. A field made required over entries that hold no
 * value, and a required field added with nothing to give existing entries, are counted here too
 * when the caller names the entity (`requiredColumns`), so the refusal names it and the count.
 *
 * @module domains/dynamic-collections/services/save-preconditions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ValidationPublicData } from "../../../errors/public-data";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { RequiredColumnEntity } from "../../schema/required-column-refusal";
import { requiredColumnSaveRefusals } from "../../schema/required-column-save-refusals";
import {
  getColumnDescriptor,
  isTextStorageKind,
} from "../../schema/services/field-column-descriptor";

import { builderColumnIsUnique } from "./dynamic-collection-schema-service";

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

/**
 * Where the entries' values are before this save: the column the field had. A renamed field's
 * migration renames the column first and only then makes it unique or narrows it, so its values
 * are checked under the old name. Undefined for a field the save adds.
 */
function heldColumn(
  previous: FieldDefinition | undefined,
  dialect: SupportedDialect
): string | undefined {
  return previous === undefined
    ? undefined
    : getColumnDescriptor(previous, dialect, "collection")?.name;
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
  /** Further renamed fields, where a save carries several the admin accepted. */
  renames?: readonly { from: FieldDefinition; to: FieldDefinition }[];
  addedColumnBackfill: (field: FieldDefinition) => string | null;
  /**
   * The columns the live table has. Outside development a save writes its migration without
   * running it, so the registry can name a field whose column is still to come; such a field has
   * no entries to check yet, and reading its column would fail.
   */
  presentColumns: ReadonlySet<string>;
  /** The entity the table belongs to, and its Drizzle handle: asks the required-column count. */
  requiredColumns?: { db: unknown; entity: RequiredColumnEntity };
  /**
   * Ask only whether a column the save makes unique holds values that repeat. The push road's
   * apply narrows other columns and fills required ones by its own preconditions, and asks this
   * one question here so both roads answer it alike.
   */
  only?: "uniqueness";
  /**
   * The columns the live table already keeps unique, where the caller read them. A column is made
   * unique by this save when its field asks for it and the table does not already hold it: a
   * one-to-one an earlier release added by an edit was recorded as one-to-one but given no unique
   * index, so its definition alone does not say the table enforces it. Without this, the field's
   * previous definition decides.
   */
  liveUniqueColumns?: ReadonlySet<string>;
}): Promise<SaveRefusal[]> {
  const { adapter, dialect } = args;
  const table = quote(dialect, args.tableName);
  const before = new Map(args.oldFields.map(f => [f.name, f]));
  const renamed = [
    ...(args.rename ? [args.rename] : []),
    ...(args.renames ?? []),
  ];
  const previousOf = (field: FieldDefinition) =>
    renamed.find(rename => rename.to.name === field.name)?.from ??
    before.get(field.name);
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
    const held = heldColumn(previous, dialect) ?? column.name;
    // A column still to be deployed holds no entries, so nothing can be in the way yet.
    if (previous !== undefined && !args.presentColumns.has(held)) continue;
    refusals.push(
      ...(await fieldRefusals(field, previous, quote(dialect, held), column))
    );
  }
  // Fields made required over rows holding no value, each named with the entity and the count.
  if (args.requiredColumns && args.only === undefined)
    refusals.push(
      ...(
        await requiredColumnSaveRefusals({
          ...args,
          ...args.requiredColumns,
          previousOf,
        })
      ).map(error => ({ error }))
    );
  return refusals;

  /**
   * Both checks, not one or the other: a field made unique and shorter in one save can pass the
   * uniqueness check with values the shorter column would cut, and PostgreSQL's cast truncates
   * them rather than refusing.
   */
  async function fieldRefusals(
    field: FieldDefinition,
    previous: FieldDefinition | undefined,
    col: string,
    column: { length?: number }
  ): Promise<SaveRefusal[]> {
    // Unique by its mark or, for a relationship the Builder stored as one-to-one, by its
    // cardinality: one rule, so a relationship becoming one-to-one is asked as a field marked
    // unique is.
    const unique =
      builderColumnIsUnique(field) && !alreadyUnique(previous)
        ? await uniqueRefusal({ field, previous, col })
        : undefined;
    const length =
      args.only === undefined
        ? await lengthRefusal({
            field,
            previous,
            col,
            length: column.length,
          })
        : undefined;
    return [unique, length].filter(
      (refusal): refusal is SaveRefusal => refusal !== undefined
    );
  }

  /** Whether the column is unique before this save: as the live table holds it, where read. */
  function alreadyUnique(previous: FieldDefinition | undefined): boolean {
    if (previous === undefined) return false;
    const held = heldColumn(previous, dialect);
    if (args.liveUniqueColumns !== undefined && held !== undefined) {
      return args.liveUniqueColumns.has(held);
    }
    return builderColumnIsUnique(previous);
  }

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
    // How many values repeat, and how many entries share the commonest of them: never the values,
    // which are stored content. An entry holding no value (NULL) never repeats; a unique index
    // leaves those free on every dialect.
    const [repeat] = await adapter.executeQuery<{
      n: number | string;
      most: number | string | null;
    }>(
      `SELECT COUNT(*) AS n, MAX(c) AS most FROM (SELECT COUNT(*) AS c FROM ${table} ` +
        `WHERE ${at.col} IS NOT NULL GROUP BY ${at.col} HAVING COUNT(*) > 1) repeated`
    );
    const repeated = Number(repeat?.n ?? 0);
    if (repeated === 0) return undefined;
    const most = Number(repeat?.most ?? 0);
    // The repeated value is stored content, which someone who may edit the schema need not be
    // allowed to read, so neither the message nor the log carries it.
    return refused(
      {
        path,
        code: "UNIQUE_OVER_DUPLICATES",
        message:
          at.field.type === "relationship"
            ? // A relationship made unique is one-to-one: each entry points at its own target.
              `"${at.field.name}" can't become one-to-one: ${repeated === 1 ? "1 target is" : `${repeated} targets are`} each pointed at by more than one entry. ` +
              `Point each entry at its own target, or clear the repeats, then make it one-to-one.`
            : `${entries(most)} share a value for ${at.field.name}, which must be unique. ` +
              `Give them their own values first, then turn Unique on.`,
      },
      // The field and how many values repeat, never the values: logs are kept and read more
      // widely than the table, and a value may be a secret.
      {
        field: at.field.name,
        valuesRepeated: repeated,
        entriesSharingAValue: most,
      }
    );
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
