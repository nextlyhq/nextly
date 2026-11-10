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

import { companionTableOf } from "../../domains/i18n/migration/derive-companion-spec";
import { loadLatestSnapshot } from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import {
  columnsByTable,
  keptScopeFields,
  type ExistingColumns,
} from "../../domains/schema/pipeline/kept-scope-fields";
import { columnsDeclaredBy } from "../../domains/schema/services/field-column-descriptor";

/** A kept column, on a type's own table or its translations table. */
export interface KeptColumn {
  table: string;
  column: string;
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
  return keptColumnsOf(types, columnsByTable(live, dialect));
}

/** Every collection and Single the registry records, as `keptColumnsOf` reads them. */
export async function registeredTypes(registries: {
  collections: {
    getAllCollections(): Promise<
      readonly { slug: string; tableName: string; fields?: unknown }[]
    >;
  };
  singles: {
    getAllSingles(): Promise<
      readonly { slug: string; tableName: string; fields?: unknown }[]
    >;
  };
}): Promise<RegisteredType[]> {
  const of = (
    kind: RegisteredType["kind"],
    rows: readonly { slug: string; tableName: string; fields?: unknown }[]
  ): RegisteredType[] =>
    rows.map(row => ({
      kind,
      slug: row.slug,
      tableName: row.tableName,
      fields: Array.isArray(row.fields) ? row.fields : [],
    }));
  return [
    ...of("collection", await registries.collections.getAllCollections()),
    ...of("single", await registries.singles.getAllSingles()),
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
  registries: Parameters<typeof registeredTypes>[0];
}): Promise<KeptColumnsByMode> {
  const types = await registeredTypes(args.registries);
  const latest = await loadLatestSnapshot(
    resolve(args.cwd ?? process.cwd(), args.migrationsDir, "meta")
  );
  if (latest === null) {
    return {
      live: () =>
        liveKeptColumns(args.adapter.getDrizzle(), args.dialect, types),
      inMigration: [],
    };
  }
  return {
    inMigration: keptColumnsOf(
      types,
      columnsByTable(latest.data.snapshot, args.dialect)
    ),
  };
}
