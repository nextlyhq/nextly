/**
 * The columns a plugin's scope keeps on types the site switched off, which
 * `nextly prune` drops.
 *
 * A type switched off for a plugin's field after its column was made keeps
 * the column and its values while it is off (`kept-scope-fields.ts`). Every
 * schema change keeps it, so the data-loss consent of `nextly prune` is the one
 * way to let it go: on a site that applies its schema directly the prune drops
 * it, and on one that keeps migration files it writes the migration that does.
 *
 * Judged over the registry's types, the configuration's and the Schema
 * Builder's alike, by the same rule every schema change keeps them by.
 *
 * @module cli/commands/prune-kept-columns
 */

import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../collections/fields/types";
import { companionTableOf } from "../../domains/i18n/migration/derive-companion-spec";
import { loadLatestSnapshot } from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import {
  columnsByTable,
  keptScopeFields,
  type ExistingColumns,
} from "../../domains/schema/pipeline/kept-scope-fields";
import { scopedTypeKey } from "../../domains/schema/pipeline/withheld-scope-fields";
import { columnsDeclaredBy } from "../../domains/schema/services/field-column-descriptor";
import { resolveCollectionTableName } from "../../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import type { DeferredExtend } from "../../plugins/schema/apply-contributions";
import { reconcileBuilderContributions } from "../../plugins/schema/reconcile-builder-contributions";

/** A kept column, on a type's own table or its translations table. */
export interface KeptColumn {
  table: string;
  column: string;
  /**
   * The indexes on its table that cover it, read from the live tables. SQLite
   * drops neither a column an index covers nor the index with it, and MySQL
   * no column a functional index names, so the prune drops these first there.
   */
  indexes?: string[];
}

/** A type as the registry records it, with the fields it declares now. */
export interface RegisteredType {
  kind: "collection" | "single";
  slug: string;
  tableName: string;
  fields: readonly unknown[];
}

/** The columns `existing` has for the fields each of `types` keeps. */
function keptColumnsOf(
  types: readonly RegisteredType[],
  existing: ExistingColumns
): KeptColumn[] {
  const kept: KeptColumn[] = [];
  for (const type of types) {
    const tables = [type.tableName, companionTableOf(type.tableName)];
    for (const field of keptScopeFields(type.kind, type, existing)) {
      for (const column of columnsDeclaredBy([field])) {
        for (const table of tables) {
          if (existing.names.get(table)?.has(column)) {
            kept.push({ table, column });
          }
        }
      }
    }
  }
  return kept;
}

/** The kept columns the database has now, read from its tables. */
export async function liveKeptColumns(
  db: unknown,
  dialect: SupportedDialect,
  types: readonly RegisteredType[]
): Promise<KeptColumn[]> {
  const tables = types.flatMap(type => [
    type.tableName,
    companionTableOf(type.tableName),
  ]);
  const live = await introspectLiveSnapshot(db, dialect, tables);
  return keptColumnsOf(types, columnsByTable(live, dialect)).map(kept => ({
    ...kept,
    indexes: (
      live.tables.find(table => table.name === kept.table)?.indexes ?? []
    )
      .filter(index => coversColumn(index, kept.column))
      .map(index => index.name),
  }));
}

/**
 * Whether `index` covers `column`: by its column list, or, for an expression
 * index, which reports none, by naming the column in its expression, as the
 * functional index keying a translated unique field does on MySQL.
 */
function coversColumn(
  index: { columns: readonly string[]; expression?: string },
  column: string
): boolean {
  if (index.columns.includes(column)) return true;
  if (index.expression === undefined) return false;
  const named = new RegExp(
    `(^|[^A-Za-z0-9_])${column.replace(/[^A-Za-z0-9_]/g, "")}($|[^A-Za-z0-9_])`
  );
  return named.test(index.expression);
}

/** A registry row, as the registries list them. */
interface RegistryRow {
  slug: string;
  tableName: string;
  fields?: unknown;
  source?: string;
}

/** The configuration's collections and Singles, with the fields they declare now. */
export function configuredTypes(config: {
  collections?: readonly { slug: string; dbName?: string; fields?: unknown }[];
  singles?: readonly { slug: string; dbName?: string; fields?: unknown }[];
}): RegisteredType[] {
  const fieldsOf = (entity: { fields?: unknown }) =>
    Array.isArray(entity.fields) ? entity.fields : [];
  return [
    ...(config.collections ?? []).map(entity => ({
      kind: "collection" as const,
      slug: entity.slug,
      tableName: resolveCollectionTableName(entity.slug, entity.dbName),
      fields: fieldsOf(entity),
    })),
    ...(config.singles ?? []).map(entity => ({
      kind: "single" as const,
      slug: entity.slug,
      tableName: resolveSingleTableName({
        slug: entity.slug,
        dbName: entity.dbName,
      }),
      fields: fieldsOf(entity),
    })),
  ];
}

/**
 * Every type with the fields it declares now: the configuration's as it reads
 * now, and the Schema Builder's from their registry rows as the running site
 * reconciles them with the configuration's plugin clauses
 * (`reconcileBuilderContributions`). A row still lists a plugin's field until
 * the site next starts, so a field its scope now holds back must not be read
 * as declared, while one a clause naming the type still gives it is.
 */
export async function currentTypes(args: {
  configured: readonly RegisteredType[];
  /** The configuration's plugin clauses left for the Builder's types. */
  deferredExtends: readonly DeferredExtend[];
  registries: {
    collections: { getAllCollections(): Promise<readonly RegistryRow[]> };
    singles: { getAllSingles(): Promise<readonly RegistryRow[]> };
  };
}): Promise<RegisteredType[]> {
  const configured = new Set(
    args.configured.map(type => scopedTypeKey(type.kind, type.slug))
  );
  const builderRows = (
    kind: RegisteredType["kind"],
    rows: readonly RegistryRow[]
  ) =>
    rows.filter(
      row =>
        row.source === "ui" && !configured.has(scopedTypeKey(kind, row.slug))
    );
  const collections = builderRows(
    "collection",
    await args.registries.collections.getAllCollections()
  );
  const singles = builderRows(
    "single",
    await args.registries.singles.getAllSingles()
  );
  const asEntity = (row: RegistryRow) => ({
    slug: row.slug,
    fields: (Array.isArray(row.fields) ? row.fields : []) as FieldConfig[],
  });
  const { entities } = reconcileBuilderContributions(
    [...args.deferredExtends],
    {
      collections: collections.map(asEntity),
      singles: singles.map(asEntity),
    }
  );
  const reconciled = (
    kind: RegisteredType["kind"],
    rows: readonly RegistryRow[],
    now: readonly { slug: string; fields?: readonly unknown[] }[] = []
  ): RegisteredType[] =>
    rows.map(row => ({
      kind,
      slug: row.slug,
      tableName: row.tableName,
      fields: now.find(entity => entity.slug === row.slug)?.fields ?? [],
    }));
  return [
    ...args.configured,
    ...reconciled("collection", collections, entities.collections),
    ...reconciled("single", singles, entities.singles),
  ];
}

/** Where `nextly prune` finds the kept columns, by how the site applies its schema. */
export interface KeptColumnsByMode {
  /**
   * A site with no migration files: the kept columns its tables have, read
   * when the prune plans, which drops them.
   */
  live?: () => Promise<KeptColumn[]>;
  /**
   * A site with migration files: the kept columns its latest snapshot has,
   * which a migration the prune writes drops in every environment. Dropping
   * them from one database alone would leave its next migration refusing to
   * run, since the history would still list them.
   */
  inMigration: KeptColumn[];
}

/** The kept columns of the site `config` describes, by how it applies its schema. */
export async function keptColumnsFor(args: {
  cwd?: string;
  migrationsDir: string;
  adapter: Pick<DrizzleAdapter, "getDrizzle">;
  dialect: SupportedDialect;
  /**
   * The site's types with the fields they declare now (`currentTypes`), read
   * again each time the kept columns are: the prune plans once to ask, and
   * again under the schema lock, where a field claimed in between must cancel
   * the drop the consent agreed to.
   */
  types: () => Promise<readonly RegisteredType[]>;
}): Promise<KeptColumnsByMode> {
  const latest = await loadLatestSnapshot(
    resolve(args.cwd ?? process.cwd(), args.migrationsDir, "meta")
  );
  if (latest === null) {
    return {
      live: async () =>
        liveKeptColumns(
          args.adapter.getDrizzle(),
          args.dialect,
          await args.types()
        ),
      inMigration: [],
    };
  }
  const types = await args.types();
  // On a type's own table only. A migration never drops a translations
  // table's column, here as for any field that leaves a type: the table is
  // only ever added to. So a kept translated column is not listed as one the
  // migration drops; a site applying its schema directly drops it with the rest.
  const tables = new Set(types.map(type => type.tableName));
  return {
    inMigration: keptColumnsOf(
      types,
      columnsByTable(latest.data.snapshot, args.dialect)
    ).filter(kept => tables.has(kept.table)),
  };
}
