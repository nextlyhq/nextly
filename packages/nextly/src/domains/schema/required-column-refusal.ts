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

/** The entity kinds whose columns a road can make required. */
export type RequiredColumnEntityKind = "collection" | "single" | "fieldGroup";

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
};

/** The same kinds as named inside a sentence. */
const IN_SENTENCE: Record<RequiredColumnEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

function rows(count: number): string {
  return count === 1 ? "1 row" : `${count} rows`;
}

/** The sentence a refusal says for one column. */
export function requiredColumnBreakMessage(b: RequiredColumnBreak): string {
  const subject = `${LABELS[b.entity.kind]} '${b.entity.slug}': field '${b.field}'`;
  // For a field group, which collections and Singles hold those rows, so each can be named.
  const where =
    b.users === undefined || b.users.length === 0
      ? ""
      : `: ${b.users.map(u => `${u.count} in ${IN_SENTENCE[u.kind]} '${u.slug}'`).join(", ")}`;
  if (b.added) {
    return `${subject} cannot be added as required without a default while ${rows(b.count)} ${b.count === 1 ? "exists" : "exist"}, which would hold no value in it${where}. Give it a default, or add it as optional.`;
  }
  const those = b.count === 1 ? "that row" : "those rows";
  return `${subject} cannot become required while ${rows(b.count)} ${b.count === 1 ? "holds" : "hold"} no value in it${where}. Give ${those} a value first, or keep the field optional.`;
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
      path: `fields.${b.field}`,
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
