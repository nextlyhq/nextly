/**
 * Gives archive rows written before `nextly_i18n_archive` recorded an entity's kind the kind of the
 * entity they belong to, where the registries can say which one that is.
 *
 * Such rows carry {@link UNKNOWN_ARCHIVE_KIND}: Singles and field groups archived as well as
 * collections, so no single kind is true of all of them. A slug names at most one collection or
 * Single (the two share one namespace) and at most one field group, so a slug that exactly one
 * registry holds is that entity's. Its rows are labelled only from the moment that entity was
 * created: a slug can be reused, and a deleted collection's translations archived before a Single
 * took its slug are not the Single's.
 *
 * One pass settles every row it finds: a row whose owner is certain gets that owner's kind, and
 * the rest become {@link UNRESOLVED_ARCHIVE_KIND} for good. Deciding once matters because the
 * registries change: while a collection and a field group share a slug, their rows are
 * ambiguous, and after the collection is deleted the field group would look like their only
 * owner. Nothing deletes an unresolved row, and a restore names it with the `--kind` that would
 * claim it.
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
  buildDynamicFieldGroupsMysql,
  buildDynamicFieldGroupsPg,
  buildDynamicFieldGroupsSqlite,
} from "../../../schemas/dynamic-field-groups";
import { dynamicSinglesMysql } from "../../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../../schemas/dynamic-singles/sqlite";
import {
  nextlyI18nArchiveTables,
  UNKNOWN_ARCHIVE_KIND,
  UNRESOLVED_ARCHIVE_KIND,
} from "../../../schemas/nextly-i18n-archive";
import { resolveFieldGroupRegistryName } from "../../field-groups/storage/resolve-storage-names";

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
  /** Which tables exist, for finding which name the field-group registry has on this database. */
  listTables(): Promise<string[]>;
  getDrizzle<T = unknown>(): T;
}

type RegistryTable =
  | typeof dynamicCollectionsPg
  | typeof dynamicCollectionsMysql
  | typeof dynamicCollectionsSqlite
  | typeof dynamicSinglesPg
  | typeof dynamicSinglesMysql
  | typeof dynamicSinglesSqlite
  | ReturnType<typeof buildDynamicFieldGroupsPg>
  | ReturnType<typeof buildDynamicFieldGroupsMysql>
  | ReturnType<typeof buildDynamicFieldGroupsSqlite>;

/**
 * Each registry, with the kind the archive records for its entities, on this database. The
 * field-group registry is found by name, since its storage migration renames it: reading only the
 * old name would miss every field group on a migrated database, and make a collection sharing a
 * slug look like its rows' only owner.
 */
async function registries(
  adapter: LabelArchiveAdapter
): Promise<{ kind: I18nTransitionKind; table: RegistryTable }[]> {
  const fieldGroupRegistry = await resolveFieldGroupRegistryName(adapter);
  const byDialect = {
    postgresql: () => [
      dynamicCollectionsPg,
      dynamicSinglesPg,
      buildDynamicFieldGroupsPg(fieldGroupRegistry),
    ],
    mysql: () => [
      dynamicCollectionsMysql,
      dynamicSinglesMysql,
      buildDynamicFieldGroupsMysql(fieldGroupRegistry),
    ],
    sqlite: () => [
      dynamicCollectionsSqlite,
      dynamicSinglesSqlite,
      buildDynamicFieldGroupsSqlite(fieldGroupRegistry),
    ],
  } as const;
  const [collections, singles, fieldGroups] = byDialect[adapter.dialect]();
  return [
    { kind: "collection", table: collections },
    { kind: "single", table: singles },
    { kind: "fieldGroup", table: fieldGroups },
  ];
}

/** How many slugs one registry read names, inside every dialect's bound-parameter limit. */
const SLUGS_PER_READ = 200;

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
  for (const { kind, table } of await registries(adapter)) {
    // A database that never registered an entity of this kind has no table for it, and so no
    // holder of any slug.
    if (!(await adapter.tableExists(getTableName(table)))) continue;
    const rows: { slug: string; createdAt: Date }[] = [];
    for (let i = 0; i < slugs.length; i += SLUGS_PER_READ) {
      rows.push(
        ...((await db
          .select({ slug: table.slug, createdAt: table.createdAt })
          .from(table)
          .where(inArray(table.slug, slugs.slice(i, i + SLUGS_PER_READ)))) as {
          slug: string;
          createdAt: Date;
        }[])
      );
    }
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
 * How long after an entity's recorded creation a row has to have been archived to be counted as
 * its own, in seconds.
 *
 * PostgreSQL and MySQL keep a registry's creation time without a time zone, and it is written in
 * more than one zone (the application's clock, or the database's `now()` in the session's zone),
 * so read back it can be off by any UTC offset. Fourteen hours, the widest offset there is, keeps a
 * row archived before the entity existed from ever passing; a row archived within that window of
 * its creation stays unresolved, and is still restored by naming its kind. SQLite stores both as
 * epoch seconds, so only its rounding needs room.
 */
function creationMargin(dialect: SupportedDialect): number {
  return dialect === "sqlite" ? 1 : 14 * 60 * 60;
}

/**
 * Settles the unknown rows: those whose owner the registries identify get its kind, and the rest
 * become unresolved. Idempotent: it reads and writes only rows still unknown, so it can run before
 * every read that scopes the archive by kind.
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
          // Rows archived before the entity existed belong to whatever held the slug then.
          sql`${archivedEpoch(adapter.dialect, archive.archivedAt)} >= ${Math.floor(createdAt.getTime() / 1000) + creationMargin(adapter.dialect)}`
        )
      );
  }
  // Every row this pass did not label stays without an owner, decided now rather than later.
  await db
    .update(archive)
    .set({ entityKind: UNRESOLVED_ARCHIVE_KIND })
    .where(unknown);
}
