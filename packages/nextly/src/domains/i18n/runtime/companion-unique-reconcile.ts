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
    let refusals = refusalsForUnindexableTranslatedUnique(adapter, missing);
    if (refusals.length === 0 && missing.length > 0) {
      refusals = refusalsForTranslatedUniqueOverDuplicates(
        await duplicateTranslatedValues(adapter, companionTable, missing)
      );
    }
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
