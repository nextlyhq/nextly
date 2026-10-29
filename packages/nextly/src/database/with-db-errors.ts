import { columnsDeclaredBy } from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors/nextly-error";

import { isDbError } from "./errors";
import {
  firstIdentifierNamed,
  missingSchemaObject,
  tableOfMissingColumn,
} from "./missing-column";

/**
 * Pattern A from spec §8.3: wrap any DB-touching block so a DbError thrown
 * inside is auto-converted to a NextlyError with a generic public message.
 *
 * Use this in the 90% case at repository or service boundaries:
 *
 * ```ts
 * const post = await withDbErrors(() =>
 *   db.insert(posts).values(input).returning(),
 * );
 * ```
 *
 * For security-sensitive flows (e.g., registration silent-success on a
 * unique-violation against `users_email_key`), catch the DbError yourself
 * (Pattern B) and decide before re-throwing.
 *
 * NextlyError instances and plain Errors thrown inside are re-thrown
 * unchanged so callers' explicit error semantics survive.
 */
export async function withDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDbError(err)) {
      throw NextlyError.fromDatabaseError(err);
    }
    throw err;
  }
}

/** An entity's registry row, as far as {@link asNotMigrated} reads it. */
type RegistryRowShape = { tableName?: unknown; fields?: unknown };

/**
 * The collection or Single a failed read or write was for, as
 * {@link asNotMigrated} names it. `load` reads its registry row, and runs only
 * once the error is known to report something missing, so a failure of any
 * other kind costs no read.
 */
export interface NotMigratedEntity {
  kind: "collection" | "single";
  slug: string;
  load: () => Promise<RegistryRowShape | null | undefined>;
}

/**
 * A collection, read from the registry service its entry services hold. A
 * failure inside a transaction passes the transaction's executor, so the read
 * never waits on the pool for a second connection while the transaction holds
 * one.
 */
export function collectionNotMigrated(
  registry: {
    getCollection(
      slug: string,
      executor?: unknown
    ): Promise<RegistryRowShape | null>;
  },
  slug: string,
  executor?: unknown
): NotMigratedEntity {
  return {
    kind: "collection",
    slug,
    load: () => registry.getCollection(slug, executor),
  };
}

/** A Single, read from the registry service its document services hold. */
export function singleNotMigrated(
  registry: {
    getSingleBySlug(slug: string): Promise<RegistryRowShape | null>;
  },
  slug: string
): NotMigratedEntity {
  return { kind: "single", slug, load: () => registry.getSingleBySlug(slug) };
}

/**
 * `error`, or the answer it stands for when it says the database has not been
 * migrated for `entity`: one of its declared fields' columns is missing, its
 * table is missing, or this running instance never registered it.
 *
 * The one place that decides it, for every read and write of an entry. Each
 * failure path that knows which entity it was serving passes its error through
 * here before answering, and answers what comes back as it answers any error,
 * so a `NextlyError` it returns keeps its code and message on every door.
 *
 * The answer is given only when the missing object is the entity's own: its
 * table, or the column of one of its fields, named by the driver's own message.
 * Anything else missing (a companion or system table, a column no field
 * declares) is left as it was, rather than sending the operator after the
 * wrong object; so is everything else, and so is the error when the registry
 * row cannot be read.
 */
export async function asNotMigrated(
  error: unknown,
  entity: NotMigratedEntity
): Promise<unknown> {
  // A typed answer keeps its meaning. An internal error says only that the
  // failure was unexpected, and a layer below may have made one of the
  // driver's error, so its cause is read like any other.
  if (NextlyError.is(error) && error.code !== "INTERNAL_ERROR") return error;
  const report = missingSchemaObject(error);
  if (!report) return error;
  const row = await entity.load().catch(() => null);
  const table = row?.tableName;
  if (typeof table !== "string" || table.length === 0) return error;
  const subject = {
    kind: entity.kind,
    slug: entity.slug,
    table,
    cause: error instanceof Error ? error : undefined,
  };
  if (report.object !== "column") {
    return firstIdentifierNamed(report.text, [table]) === table
      ? NextlyError.notMigrated({ ...subject, reason: report.object })
      : error;
  }
  const field = fieldWhoseColumnIsNamed(report.text, row?.fields, table);
  return field === undefined
    ? error
    : NextlyError.notMigrated({ ...subject, reason: "column", field });
}

/**
 * The field, of a registry row's `fields`, whose column `text` names as
 * missing from the entity's own table or its `_locales` companion, where a
 * translatable field's column lives; or undefined when it names none, or says
 * the column belongs to another table. Each field's column is the one
 * `columnsDeclaredBy` gives it, the schema's own rule.
 */
function fieldWhoseColumnIsNamed(
  text: string,
  fields: unknown,
  table: string
): string | undefined {
  const fieldByColumn = new Map<string, string>();
  for (const field of Array.isArray(fields) ? fields : []) {
    const name = (field as { name?: unknown } | null)?.name;
    if (typeof name !== "string") continue;
    for (const column of columnsDeclaredBy([field])) {
      fieldByColumn.set(column, name);
    }
  }
  const column = firstIdentifierNamed(text, fieldByColumn.keys());
  if (column === undefined) return undefined;
  return isEntityTable(tableOfMissingColumn(text, column), table)
    ? fieldByColumn.get(column)
    : undefined;
}

/**
 * Whether the table a driver says a missing column belongs to is the entity's
 * own or its `_locales` companion. A message that names no table (MySQL's,
 * unqualified) is taken as the statement's own table.
 */
function isEntityTable(owner: string | undefined, table: string): boolean {
  return owner === undefined || owner === table || owner === `${table}_locales`;
}
