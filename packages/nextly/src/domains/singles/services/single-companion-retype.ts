/**
 * The translations columns a Single's save gives their fields' new types, where its own statements
 * apply it (in production, and wherever the save carries values across its change): the statements
 * the save's migration file carries for every other database (`planCompanionTypeChange`), here and
 * back. Each language's value is judged by the database's cast before any of them runs
 * (`fieldTypeChangeRefusals`), so none reaches a column it cannot be read in.
 *
 * Run before the Single's own table changes: a column that does not take its type then fails the
 * save with nothing else changed, and one whose Single's table is refused after it is given back the
 * type and the values it had. A field's Unique setting is the companion reconcile's, after it: the
 * column keeps the index it had, made again on the new type.
 *
 * @module domains/singles/services/single-companion-retype
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isTextKind } from "../../i18n/migration/companion-unique-indexes";
import {
  planCompanionTypeChange,
  retypedCompanionColumns,
  type RetypedField,
} from "../../i18n/migration/plan-companion-type-change";
import { refusalsForUnindexableTranslatedUnique } from "../../i18n/migration/translated-unique-preconditions";
import { splitSqlStatements } from "../../schema/migrate/split-sql";

/** The columns a save's statements retype, and the statements, each way. */
export interface SingleCompanionRetype {
  /** The fields whose translations column takes a new type, by name. */
  fields: ReadonlySet<string>;
  /** The statements giving each column its new type, as one migration. */
  upSql: string;
  /** Those giving each back its type and its values. */
  downSql: string;
}

/**
 * What a save's statements give the Single's translations columns, or undefined where none of its
 * translated fields' columns takes another type on this database.
 */
export function singleCompanionRetype(args: {
  adapter: Pick<DrizzleAdapter, "getCapabilities">;
  slug: string;
  tableName: string;
  defaultLocale: string;
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  /** The fields kept per language before the save and after it. */
  translatedBefore: ReadonlySet<string>;
  translatedAfter: ReadonlySet<string>;
}): SingleCompanionRetype | undefined {
  const { dialect } = args.adapter.getCapabilities();
  // A Single's table is built by the collection's generator.
  const at = { dialect, builtBy: "collection" as const };
  const fields = keptPerLanguage(args).filter(field =>
    canBeIndexed(args.adapter, field)
  );
  const retyped = retypedCompanionColumns({ fields, ...at });
  const plan = planCompanionTypeChange({
    slug: args.slug,
    kind: "single",
    tableName: args.tableName,
    defaultLocale: args.defaultLocale,
    fields,
    ...at,
  });
  return plan === undefined
    ? undefined
    : {
        fields: new Set(retyped.map(column => column.field)),
        upSql: asMigration(plan.upSql, dialect),
        downSql: asMigration(plan.downSql, dialect),
      };
}

/** A file's statements as a Single's migration holds them, one after another at breakpoints. */
function asMigration(sql: string, dialect: SupportedDialect): string {
  return splitSqlStatements(sql, dialect).join("\n--> statement-breakpoint\n");
}

/**
 * The fields kept per language before the save and after it under one name, each with the index its
 * column has while its type changes: the one it had before, which the companion reconcile makes or
 * drops after.
 */
function keptPerLanguage(args: {
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  translatedBefore: ReadonlySet<string>;
  translatedAfter: ReadonlySet<string>;
}): RetypedField[] {
  const before = new Map(args.previous.map(field => [field.name, field]));
  return args.next.flatMap(field => {
    const from = before.get(field.name);
    if (from === undefined) return [];
    if (!args.translatedBefore.has(field.name)) return [];
    if (!args.translatedAfter.has(field.name)) return [];
    return [{ from, to: { ...field, unique: from.unique } }];
  });
}

/**
 * Whether the index a field's column has can be made again on its new type: not a unique one on a
 * type this database cannot index, which would stop the change with the index already gone.
 */
function canBeIndexed(
  adapter: Pick<DrizzleAdapter, "getCapabilities">,
  field: RetypedField
): boolean {
  const { dialect } = adapter.getCapabilities();
  const [column] = retypedCompanionColumns({
    fields: [field],
    dialect,
    builtBy: "collection",
  });
  if (column === undefined || !column.unique) return true;
  const { name, kind } = column.to;
  return (
    refusalsForUnindexableTranslatedUnique(adapter, [
      { field: column.field, column: name, text: isTextKind(kind), kind },
    ]).length === 0
  );
}
