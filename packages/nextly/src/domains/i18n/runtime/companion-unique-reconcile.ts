/**
 * Brings a translated entity's per-language unique indexes in step with its fields, on the paths
 * that keep a code-first companion current without a migration file: `db:sync` and the reload
 * under `next dev`. Each runs it after the companion's columns are in step.
 *
 * An index is created for each translated field marked unique and dropped for each that no longer
 * is. Dropping one loses nothing, so it runs unattended. Creating one is held back, and reported,
 * where the rule cannot hold: on a server that cannot key the index, or where a language already
 * holds a value twice, naming the documents. The other fields' indexes still go ahead.
 *
 * @module domains/i18n/runtime/companion-unique-reconcile
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { consoleLogger } from "../../../shared/types";
import {
  readIndexUniqueness,
  uniqueIndexNames,
} from "../../schema/pipeline/live-table-facts";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import {
  companionUniqueIndexName,
  companionUniqueIndexStatements,
  translatedColumnNames,
  type UniqueFieldLike,
  uniqueTranslatedColumns,
} from "../migration/companion-unique-indexes";
import {
  duplicateTranslatedValues,
  refusalsForTranslatedUniqueOverDuplicates,
  refusalsForUnindexableTranslatedUnique,
} from "../migration/translated-unique-preconditions";

import { companionTableExists } from "./companion-io";

/** The adapter surface the reconcile uses: introspection, its capabilities, and statements. */
export type CompanionUniqueAdapter = Pick<
  DrizzleAdapter,
  | "dialect"
  | "getDrizzle"
  | "getCapabilities"
  | "queryStatement"
  | "executeQuery"
>;

/**
 * Creates and drops the companion's per-language unique indexes so they match `fields`. No-op
 * when the companion is absent; creating it is `ensureCompanionTable`'s job.
 *
 * Reports through `onError`, never throws: a field whose rule cannot hold is named there and
 * left without its index, and a statement the database refuses is passed on as it came.
 */
export async function reconcileCompanionUniqueIndexes(
  adapter: CompanionUniqueAdapter,
  args: {
    /** Which builder made the main table, which decides each translated column's name. */
    builtBy: ColumnOrigin;
    tableName: string;
    fields: readonly UniqueFieldLike[];
  },
  onError?: (error: unknown) => void
): Promise<void> {
  const { dialect } = adapter;
  const companionTable = `${args.tableName}_locales`;
  const shape = {
    fields: args.fields,
    entityLocalized: true,
    dialect,
    builtBy: args.builtBy,
  };
  const translatedColumns = translatedColumnNames(shape);
  // Judged by the fields first: an entity with nothing translated has no index to keep.
  if (translatedColumns.length === 0) return;
  try {
    if (!(await companionTableExists(adapter, companionTable))) return;
    const indexes = await readIndexUniqueness(
      adapter.getDrizzle(),
      dialect,
      companionTable
    );
    // One under the name that is not unique holds nothing: it counts as missing for the checks,
    // and is replaced.
    const unique = uniqueIndexNames(indexes);
    const wanted = uniqueTranslatedColumns(shape);
    const missing = wanted.filter(
      c => !unique.has(companionUniqueIndexName(companionTable, c.column))
    );
    const unindexable = refusalsForUnindexableTranslatedUnique(
      adapter,
      missing
    );
    // The fields still worth checking: one held back for a column this server cannot key says
    // nothing about the others. Asking only when none was refused left a duplicated number
    // alongside a refused text field unchecked, and its index failed at DDL time, after the
    // earlier ones had run.
    const refusedForDialect = new Set(unindexable.map(r => r.path));
    const indexable = missing.filter(
      c => !refusedForDialect.has(`fields.${c.field}`)
    );
    const refusals = [
      ...unindexable,
      ...(indexable.length > 0
        ? refusalsForTranslatedUniqueOverDuplicates(
            await duplicateTranslatedValues(adapter, companionTable, indexable)
          )
        : []),
    ];
    const held = new Set(refusals.map(r => r.path));
    for (const statement of companionUniqueIndexStatements({
      dialect,
      companionTable,
      wanted: wanted.filter(c => !held.has(`fields.${c.field}`)),
      translatedColumns,
      liveIndexNames: new Set(indexes.keys()),
      liveNotUnique: new Set(
        [...indexes.keys()].filter(name => !unique.has(name))
      ),
    })) {
      await adapter.executeQuery(statement);
    }
    if (refusals.length > 0) {
      onError?.(
        NextlyError.conflict({
          reason: "state",
          message: refusals.map(r => r.message).join(" "),
        })
      );
    }
  } catch (error) {
    onError?.(error);
  }
}

/**
 * {@link reconcileCompanionUniqueIndexes} for a translations table a start has just made or
 * completed (`ensureCompanionTable`), so a unique translated field is enforced in each language
 * on a database a start provisioned, as it is on one `nextly migrate` or the development reload
 * provisioned. Every installation keeps its text fields in that table, a slug included, and a
 * start that made the table without its indexes accepted a value twice.
 *
 * Never throws, so a start goes on: a field whose rule cannot hold (a value a language already
 * holds twice, or a column this server cannot key) is left without its index and named in a
 * warning, with the documents that hold the value, as the development reload names it.
 */
export async function reconcileCompanionUniquesAtStart(
  adapter: CompanionUniqueAdapter,
  args: {
    builtBy: ColumnOrigin;
    /** The entity, as the warning names it. */
    slug: string;
    tableName: string;
    fields: readonly UniqueFieldLike[];
  },
  warn: (message: string) => void = message => consoleLogger.warn(message)
): Promise<void> {
  await reconcileCompanionUniqueIndexes(
    adapter,
    { builtBy: args.builtBy, tableName: args.tableName, fields: args.fields },
    error => {
      warn(
        `[nextly] Could not index the translations table for "${args.slug}". ` +
          `Unique translated fields are not enforced in each language until it is: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  );
}
