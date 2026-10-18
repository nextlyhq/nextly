/**
 * Gives archive rows written before `nextly_i18n_archive` recorded an entity's kind the kind of the
 * entity they belong to, where the registries can say which one that is.
 *
 * Such rows carry {@link UNKNOWN_ARCHIVE_KIND}: Singles and field groups archived as well as
 * collections, so no single kind is true of all of them. A slug names at most one collection or
 * Single (the two share one namespace) and at most one field group, so a slug that exactly one
 * registry holds today is that entity's. Its rows are labelled only from the moment that entity
 * was created: a slug can be reused, and a deleted collection's translations archived before a
 * Single took its slug are not the Single's. Those rows, and the rows of a slug two registries
 * hold or none does, stay unknown. Nothing deletes them, and a restore names them with the
 * `--kind` that would claim them.
 *
 * Only the new column is written. The archived values themselves are never changed.
 *
 * @module domains/i18n/migration/label-legacy-archive-rows
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, getTableName, inArray, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import { dynamicCollectionsMysql } from "../../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../../schemas/dynamic-collections/sqlite";
import {
  dynamicFieldGroupsMysql,
  dynamicFieldGroupsPg,
  dynamicFieldGroupsSqlite,
} from "../../../schemas/dynamic-field-groups";
import { dynamicSinglesMysql } from "../../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../../schemas/dynamic-singles/sqlite";
import {
  nextlyI18nArchiveTables,
  UNKNOWN_ARCHIVE_KIND,
} from "../../../schemas/nextly-i18n-archive";

import type { I18nTransitionKind } from "./transition-state";

/**
 * The slice of Drizzle this drives: distinct reads, a registry read and a scoped UPDATE. Declared
 * narrowly, as the other archive helpers do, so the dialect's database type stays out of the port.
 */
interface LabelDb {
  selectDistinct(columns: Record<string, unknown>): {
    from(table: unknown): { where(condition: unknown): Promise<unknown> };
  };
  select(columns: Record<string, unknown>): {
    from(table: unknown): { where(condition: unknown): Promise<unknown> };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

/** What labelling needs of the connection. */
export interface LabelArchiveAdapter {
  dialect: SupportedDialect;
  tableExists(tableName: string): Promise<boolean>;
  getDrizzle<T = unknown>(): T;
}

type RegistryTable =
  | typeof dynamicCollectionsPg
  | typeof dynamicCollectionsMysql
  | typeof dynamicCollectionsSqlite
  | typeof dynamicSinglesPg
  | typeof dynamicSinglesMysql
  | typeof dynamicSinglesSqlite
  | typeof dynamicFieldGroupsPg
  | typeof dynamicFieldGroupsMysql
  | typeof dynamicFieldGroupsSqlite;

/** Each registry, with the kind the archive records for its entities, on this dialect. */
function registries(
  dialect: SupportedDialect
): { kind: I18nTransitionKind; table: RegistryTable }[] {
  const byDialect = {
    postgresql: [dynamicCollectionsPg, dynamicSinglesPg, dynamicFieldGroupsPg],
    mysql: [
      dynamicCollectionsMysql,
      dynamicSinglesMysql,
      dynamicFieldGroupsMysql,
    ],
    sqlite: [
      dynamicCollectionsSqlite,
      dynamicSinglesSqlite,
      dynamicFieldGroupsSqlite,
    ],
  } as const;
  const [collections, singles, fieldGroups] = byDialect[dialect];
  return [
    { kind: "collection", table: collections },
    { kind: "single", table: singles },
    { kind: "fieldGroup", table: fieldGroups },
  ];
}

/** Every entity holding one of `slugs`, with its kind and when it was created. */
async function holdersOf(
  adapter: LabelArchiveAdapter,
  db: LabelDb,
  slugs: string[]
): Promise<Map<string, { kind: I18nTransitionKind; createdAt: Date }[]>> {
  const holders = new Map<
    string,
    { kind: I18nTransitionKind; createdAt: Date }[]
  >();
  for (const { kind, table } of registries(adapter.dialect)) {
    // A database that never registered an entity of this kind has no table for it, and so no
    // holder of any slug.
    if (!(await adapter.tableExists(getTableName(table)))) continue;
    const rows = (await db
      .select({ slug: table.slug, createdAt: table.createdAt })
      .from(table)
      .where(inArray(table.slug, slugs))) as {
      slug: string;
      createdAt: Date;
    }[];
    for (const row of rows) {
      holders.set(row.slug, [
        ...(holders.get(row.slug) ?? []),
        { kind, createdAt: row.createdAt },
      ]);
    }
  }
  return holders;
}

/**
 * `archived_at` as seconds since the epoch, converted by the database that wrote it.
 *
 * Compared as instants rather than as dates handed to the driver, because the two sides were
 * written by different clocks. MySQL's `archived_at` is the server's `CURRENT_TIMESTAMP` in its own
 * time zone, while a registry's `created_at` is written and read back by the driver in the
 * application's; a date bound against the column would be off by the difference between them.
 */
function archivedEpoch(dialect: SupportedDialect, column: AnyColumn): SQL {
  switch (dialect) {
    case "postgresql":
      return sql`extract(epoch from ${column})`;
    case "mysql":
      return sql`UNIX_TIMESTAMP(${column})`;
    case "sqlite":
      return sql`${column}`;
  }
}

/**
 * Labels the unknown rows whose owner the registries identify. Idempotent: it reads and writes
 * only rows still unknown, so it can run before every read that scopes the archive by kind.
 */
export async function labelLegacyArchiveRows(
  adapter: LabelArchiveAdapter
): Promise<void> {
  const db = adapter.getDrizzle<LabelDb>();
  const { nextlyI18nArchive: archive } = nextlyI18nArchiveTables(
    adapter.dialect
  );
  const unknown = eq(archive.entityKind, UNKNOWN_ARCHIVE_KIND);
  const slugs = (
    (await db
      .selectDistinct({ slug: archive.collection })
      .from(archive)
      .where(unknown)) as { slug: string }[]
  ).map(r => r.slug);
  if (slugs.length === 0) return;

  const holders = await holdersOf(adapter, db, slugs);
  for (const slug of slugs) {
    const found = holders.get(slug) ?? [];
    if (found.length !== 1) continue;
    const [{ kind, createdAt }] = found;
    await db
      .update(archive)
      .set({ entityKind: kind })
      .where(
        and(
          unknown,
          eq(archive.collection, slug),
          // Rows archived before the entity existed belong to whatever held the slug then. Whole
          // seconds with one to spare: MySQL rounds a creation time to the second, which can put
          // it after a row archived in the same second. A slug is not reused within one.
          sql`${archivedEpoch(adapter.dialect, archive.archivedAt)} >= ${Math.floor(createdAt.getTime() / 1000) - 1}`
        )
      );
  }
}
