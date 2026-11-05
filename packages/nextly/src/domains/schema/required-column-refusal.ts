/**
 * The one refusal for a column made NOT NULL over rows that would break it.
 *
 * Every road that can make a column required (a Builder apply, a schema save, the development
 * push, `nextly migrate` applying a file) counts those rows before anything runs, with
 * `countRowsBreakingNotNull`, and refuses with this error, so each road names the entity, the
 * field and the count the same way. A field group's rows live in one table shared by every
 * collection and Single that uses it, so its refusal also names each of them with its count.
 *
 * @module domains/schema/required-column-refusal
 */

import { NextlyError } from "../../errors/nextly-error";

/**
 * The kinds of table a road can make a column required on: an entity's, or (`table`) one that is
 * not a collection, a Single or a field group, such as a plugin's, named by its table.
 */
export type RequiredColumnEntityKind =
  | "collection"
  | "single"
  | "fieldGroup"
  | "table";

/** An entity, as a refusal names it. */
export interface RequiredColumnEntity {
  kind: RequiredColumnEntityKind;
  slug: string;
}

/** One column a change would make NOT NULL, and the rows that would break it. */
export interface RequiredColumnBreak {
  entity: RequiredColumnEntity;
  /** The field whose column it is. */
  field: string;
  /** The rows that would hold no value in it once the change ran. */
  count: number;
  /**
   * `true` for a required field added without a default, where every existing row would hold no
   * value; `false` for a field made required, where the rows already holding null are counted.
   */
  added: boolean;
  /** For a field group, the collections and Singles whose rows those are, each with its count. */
  users?: ReadonlyArray<RequiredColumnEntity & { count: number }>;
}

const LABELS: Record<RequiredColumnEntityKind, string> = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
  table: "Table",
};

/** The same kinds as named inside a sentence. */
const IN_SENTENCE: Record<RequiredColumnEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
  table: "table",
};

/** A table that is not an entity has columns, not fields, and they are nullable, not optional. */
function wordsFor(kind: RequiredColumnEntityKind) {
  return kind === "table"
    ? { thing: "column", optional: "nullable" }
    : { thing: "field", optional: "optional" };
}

function rows(count: number): string {
  return count === 1 ? "1 row" : `${count} rows`;
}

/** The sentence a refusal says for one column. */
export function requiredColumnBreakMessage(b: RequiredColumnBreak): string {
  const words = wordsFor(b.entity.kind);
  const subject = `${LABELS[b.entity.kind]} '${b.entity.slug}': ${words.thing} '${b.field}'`;
  // For a field group, which collections and Singles hold those rows, so each can be named.
  const where =
    b.users === undefined || b.users.length === 0
      ? ""
      : `: ${b.users.map(u => `${u.count} in ${IN_SENTENCE[u.kind]} '${u.slug}'`).join(", ")}`;
  if (b.added) {
    return `${subject} cannot be added as required without a default while ${rows(b.count)} ${b.count === 1 ? "exists" : "exist"}, which would hold no value in it${where}. Give it a default, or add it as ${words.optional}.`;
  }
  const those = b.count === 1 ? "that row" : "those rows";
  return `${subject} cannot become required while ${rows(b.count)} ${b.count === 1 ? "holds" : "hold"} no value in it${where}. Give ${those} a value first, or keep the ${words.thing} ${words.optional}.`;
}

/**
 * The refusal: a validation error with an entry per column, on the field's path, under the code
 * a required column over nulls has always had.
 */
export function requiredColumnOverNullsError(
  breaks: readonly RequiredColumnBreak[],
  logContext: Record<string, unknown> = {}
): NextlyError {
  return NextlyError.validation({
    errors: breaks.map(b => ({
      path:
        b.entity.kind === "table"
          ? `tables.${b.entity.slug}.${b.field}`
          : `fields.${b.field}`,
      code: "REQUIRED_COLUMN_HAS_NULLS",
      message: requiredColumnBreakMessage(b),
    })),
    logContext: {
      reason: "required-column-over-nulls",
      breaks: breaks.map(b => ({
        entity: `${b.entity.kind}:${b.entity.slug}`,
        field: b.field,
        count: b.count,
        added: b.added,
      })),
      ...logContext,
    },
  });
}

/**
 * The refusal when the rows in a required column's way could not be counted: a count that
 * failed cannot say the change is safe, so every road refuses it before anything runs, naming
 * the table and the field, rather than running it and leaving the answer to the database (on
 * MySQL, after earlier statements have committed). The failure is kept as the cause.
 */
export function requiredColumnUncountedError(args: {
  table: string;
  field: string;
  cause: unknown;
  /**
   * The qualifier the table was named through, when that is why nothing was counted: one that may
   * name another schema, whose rows no count here reads.
   */
  through?: string;
}): NextlyError {
  const why =
    args.through === undefined
      ? "could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again."
      : `could not be counted through the qualifier '${args.through}', which may name another schema, so that change was refused before it ran. Write the table's unqualified name, then try again.`;
  return NextlyError.validation({
    errors: [
      {
        path: `fields.${args.field}`,
        code: "REQUIRED_COLUMN_UNCOUNTED",
        message: `Table '${args.table}': the rows that would break making '${args.field}' required ${why}`,
      },
    ],
    ...(args.cause instanceof Error ? { cause: args.cause } : {}),
    logContext: {
      reason:
        args.through === undefined
          ? "required-column-count-failed"
          : "required-column-qualifier-not-read",
      table: args.table,
      field: args.field,
    },
  });
}
