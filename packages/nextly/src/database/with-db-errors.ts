import { columnsDeclaredBy } from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors/nextly-error";

import { isDbError } from "./errors";
import {
  firstIdentifierNamed,
  missingSchemaObject,
  statementTableOf,
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
  /**
   * The fields the running configuration declares for it, where known. A
   * field declared there and missing from the served registry row is still
   * one of its fields, whose column the database has not been given.
   */
  declaredFields?: () => unknown;
}

/** A collection, read from the registry service its entry services hold. */
export function collectionNotMigrated(
  registry: { getCollection(slug: string): Promise<RegistryRowShape | null> },
  slug: string
): NotMigratedEntity {
  return { kind: "collection", slug, load: () => registry.getCollection(slug) };
}

/**
 * A collection, judged from the registry row its write already read. For a
 * failure inside a transaction: a failed statement can leave it unable to run
 * another (PostgreSQL aborts it), and a read on the pool instead would wait
 * for a second connection while the transaction holds one. A failure before
 * the row was read has no row, and is left as it was.
 */
export function collectionRowNotMigrated(
  slug: string,
  row: RegistryRowShape | undefined
): NotMigratedEntity {
  return { kind: "collection", slug, load: () => Promise.resolve(row) };
}

/** A Single, read from the registry service its document services hold. */
export function singleNotMigrated(
  registry: {
    getSingleBySlug(slug: string): Promise<RegistryRowShape | null>;
    getCodeFirstFields?(slug: string): unknown;
  },
  slug: string
): NotMigratedEntity {
  return {
    kind: "single",
    slug,
    load: () => registry.getSingleBySlug(slug),
    declaredFields: () => registry.getCodeFirstFields?.(slug),
  };
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
  entity: NotMigratedEntity,
  options: { written?: boolean } = {}
): Promise<unknown> {
  // After the write's row was written, a failure is answered as it was: the
  // committed-write answer says the change was saved, and naming a migration
  // instead would invite a retry that makes the change a second time.
  if (options.written === true) return error;
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
  const field = fieldWhoseColumnIsNamed(report.text, [
    ...listOf(row?.fields),
    ...listOf(entity.declaredFields?.()),
  ]);
  // Whose column it is: the driver's message names the table where it can,
  // and the failed statement's own table where it does not (MySQL's).
  const owner =
    field === undefined
      ? undefined
      : (tableOfMissingColumn(report.text, field.column) ??
        statementTableOf(error));
  return field !== undefined && isEntityTable(owner, table)
    ? NextlyError.notMigrated({
        ...subject,
        reason: "column",
        field: field.name,
      })
    : error;
}

/**
 * The field, of a registry row's `fields`, whose column `text` names as
 * missing, with that column; or undefined when it names none. Each field's
 * column is the one `columnsDeclaredBy` gives it, the schema's own rule.
 */
function fieldWhoseColumnIsNamed(
  text: string,
  fields: unknown
): { name: string; column: string } | undefined {
  const fieldByColumn = new Map<string, string>();
  for (const field of listOf(fields)) {
    const name = field.name;
    if (typeof name !== "string") continue;
    for (const column of columnsDeclaredBy([field])) {
      fieldByColumn.set(column, name);
    }
  }
  const column = firstIdentifierNamed(text, fieldByColumn.keys());
  const name = column === undefined ? undefined : fieldByColumn.get(column);
  return column === undefined || name === undefined
    ? undefined
    : { name, column };
}

/**
 * Whether the table a missing column belongs to is the entity's own or its
 * `_locales` companion, where a translatable field's column lives. Unknown is
 * not the entity's: a column nothing places is left as it was, not guessed.
 */
function isEntityTable(owner: string | undefined, table: string): boolean {
  return owner === table || owner === `${table}_locales`;
}

/** A field definition, as far as its column is concerned. */
type FieldShape = { name?: unknown; type?: unknown; options?: unknown };

/** The field definitions of `value`, when it is a list of them. */
function listOf(value: unknown): FieldShape[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is FieldShape => typeof item === "object" && item !== null
      )
    : [];
}
