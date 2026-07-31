/**
 * Tear down the localization artifacts an entity leaves behind when it is DELETED.
 *
 * Companion `_locales` tables are deliberately invisible to the schema pipeline: they match
 * the managed prefix but are excluded via `isCompanionTable`, and `filter-unsafe-statements`
 * discards their DROP silently, because the localization migration layer owns their
 * lifecycle. This helper is that layer's delete-path entry point, alongside
 * `buildLocalizationDownStatements` for the enable/disable transition.
 *
 * Two artifacts, two different disposal rules:
 *   - `<main>_locales` is per-entity, so it is DROPPED. It must go BEFORE the main table:
 *     it holds `FOREIGN KEY (_parent) REFERENCES <main>(id)`, and that FK blocks (MySQL) or
 *     silently orphans (Postgres CASCADE) a main-table drop attempted first.
 *   - `nextly_i18n_archive` is a SINGLE shared table scoped by a `collection` column holding
 *     the entity slug, so only the deleted entity's ROWS are removed. Dropping the table
 *     would destroy every other entity's restore trail.
 *
 * Both steps are existence-guarded. The archive is created lazily — only immediately before
 * a localization disable (`getI18nArchiveDdl` in the dispatchers) — so a database where
 * localization was never disabled legitimately has no archive table, and an unguarded
 * DELETE there would turn every entity delete into a hard failure.
 *
 * @module domains/i18n/migration/teardown-entity-i18n
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";

import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";
import { affectedRowCount } from "../../auth/services/auth-service";

import { q } from "./ddl-types";
import type { I18nTransitionKind } from "./transition-state";

/** The shared archive table, scoped per entity by its `collection` column. */
const ARCHIVE_TABLE = "nextly_i18n_archive";

/** Where the transition record lives. Absent on a database that never completed core setup. */
const META_TABLE = "nextly_meta";

/**
 * The slice of Drizzle this helper drives: a single scoped DELETE. Declaring only what is
 * used keeps the dialect-specific database type out of the port, so no `any` is needed.
 */
interface ArchiveDeleteCapableDb {
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** Minimal adapter surface this helper needs — matches DrizzleAdapter. */
export interface TeardownI18nAdapter {
  dialect: SupportedDialect;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(tableName: string): Promise<boolean>;
  getDrizzle<T = unknown>(): T;
}

/**
 * How the entity is identified, as a union so the unusable combination cannot be written.
 *
 * The transition record is keyed by kind AND slug: a collection, a single and a field group may
 * share one slug while only one of them transitioned. A caller holding a slug but no kind could
 * only guess, and guessing deletes an unrelated entity's history — so the type does not offer
 * that shape. Either both are known or neither is.
 */
export type TeardownEntityIdentity =
  | {
      /** Entity slug exactly as the disable migration records it in `archive.collection`. */
      slug: string;
      /** Which registry the slug belongs to. Completes the transition record's key. */
      kind: I18nTransitionKind;
    }
  | {
      /**
       * The catalog sweep, which finds companion tables whose registry row is already gone. A slug
       * cannot be recovered from the table name, because entities may declare a custom `tableName`.
       * The companion is still dropped; the archive purge and the transition record are both left
       * alone, since acting on either would mean guessing which entity they belong to.
       */
      slug: null;
      kind?: undefined;
    };

export interface TeardownEntityI18nArgsBase {
  adapter: TeardownI18nAdapter;

  /**
   * Physical MAIN table of the entity being deleted, e.g. `dc_pages`, `comp_seo`,
   * `single_home`. The companion name is derived as `<tableName>_locales`, matching
   * `deriveCompanionSpec`.
   */
  tableName: string;
}

export type TeardownEntityI18nArgs = TeardownEntityI18nArgsBase &
  TeardownEntityIdentity;

export interface TeardownEntityI18nResult {
  /** True when a companion table was found and dropped (false when the entity had none). */
  companionDropped: boolean;
  /** Archive rows removed for this slug (0 when the archive table does not exist). */
  archiveRowsPurged: number;
}

/**
 * Drops `<tableName>_locales` and purges the entity's `nextly_i18n_archive` rows.
 *
 * Call this BEFORE dropping the entity's main table. Errors propagate: callers drop the
 * main table and delete the registry row only after this resolves, so a failure here
 * surfaces with the entity still fully intact rather than half-deleted.
 */
export async function teardownEntityI18n(
  args: TeardownEntityI18nArgs
): Promise<TeardownEntityI18nResult> {
  const { adapter, slug, tableName } = args;
  const companionTable = `${tableName}_locales`;

  // Guarded so a non-localized entity (no companion was ever created) is a no-op rather
  // than relying on IF EXISTS semantics that differ across dialects.
  let companionDropped = false;
  if (await adapter.tableExists(companionTable)) {
    const quoted = q(companionTable, adapter.dialect);
    // Postgres needs CASCADE to also remove the FK constraint the companion owns; MySQL and
    // SQLite reject the keyword. IF EXISTS keeps the statement safe against a concurrent drop.
    const dropSql =
      adapter.dialect === "postgresql"
        ? `DROP TABLE IF EXISTS ${quoted} CASCADE`
        : `DROP TABLE IF EXISTS ${quoted}`;
    await adapter.executeQuery(dropSql);
    companionDropped = true;
    // Readiness remembers only that a companion exists, and this is one of the two things that
    // makes that false. Forgetting it here rather than at the call sites keeps the memory tied to
    // the statement that invalidates it.
    const { forgetCompanionReadiness } = await import(
      "../runtime/companion-readiness"
    );
    forgetCompanionReadiness(companionTable);
  }

  // The archive table is created lazily on the first localization disable, so its absence is
  // the normal state for many databases and must not fail the delete. A null slug means the
  // caller could not identify the entity, and the archive is keyed by slug, so there is no
  // safe row set to delete.
  let archiveRowsPurged = 0;
  if (slug !== null && (await adapter.tableExists(ARCHIVE_TABLE))) {
    const db = adapter.getDrizzle<ArchiveDeleteCapableDb>();
    const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);
    // Scoped to this slug only — the archive is shared, so an unscoped delete would wipe
    // every other entity's recoverable translations.
    const result = await db
      .delete(nextlyI18nArchive)
      .where(eq(nextlyI18nArchive.collection, slug));
    // Each driver reports the count in a different place, and mysql2 nests it inside a
    // result tuple, so the shared dialect-aware reader owns that knowledge.
    archiveRowsPurged = affectedRowCount(result, adapter.dialect);
  }

  // The transition record outlives everything else here unless it is removed: it lives in
  // `nextly_meta`, not in any of the tables dropped above, and it is keyed by kind and slug —
  // both of which a later entity can reuse. Left behind, it would hand that entity a
  // predecessor's source locale and refuse its real one, after its companion had already been
  // created and seeded.
  //
  // Skipped for the catalog sweep, which has no identity to key on. Consistent with the archive
  // above: neither is touched when acting on it would mean guessing whose it is.
  //
  // Guarded on the table's existence for the same reason the archive is: `nextly_meta` is created
  // by the core setup, and a database that never got that far still has to be able to delete an
  // entity. Failing the teardown because a bookkeeping row could not be removed would block the
  // drop it exists to perform.
  if (
    args.slug !== null &&
    args.kind !== undefined &&
    (await adapter.tableExists(META_TABLE))
  ) {
    const { resolveTransitionStore } = await import("./transition-recorder");
    const { forgetI18nTransition } = await import("./transition-state");
    await forgetI18nTransition(
      await resolveTransitionStore(adapter),
      args.kind,
      args.slug
    );
  }

  return { companionDropped, archiveRowsPurged };
}
