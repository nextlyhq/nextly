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

import { q } from "./ddl-types";
import { ensureI18nArchive, runI18nSchemaStatements } from "./ensure-archive";
import {
  ARCHIVE_TABLE,
  removeEntityTranslationRows,
  type TranslationRowsAdapter,
} from "./entity-translation-rows";
import type { I18nTransitionKind } from "./transition-state";

/**
 * Minimal adapter surface this helper needs — matches DrizzleAdapter: what the rows' removal
 * reads and deletes through, and a statement runner for the translations table's drop.
 */
export interface TeardownI18nAdapter extends TranslationRowsAdapter {
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
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
  /**
   * Records of where this entity's translated values came from, removed with it (0 when the
   * table does not exist, or for an entity that keeps none).
   */
  provenanceRowsPurged: number;
}

/**
 * Drops `tableName`'s translations table (`<tableName>_locales`) where it is
 * there, and answers whether it was. Guarded so an entity that never had one
 * is a no-op rather than relying on IF EXISTS semantics that differ across
 * dialects. `change` names, in a busy-table refusal, what the drop is part of.
 */
export async function dropTranslationsTable(
  adapter: TeardownI18nAdapter,
  tableName: string,
  change: string
): Promise<boolean> {
  const companionTable = `${tableName}_locales`;
  if (!(await adapter.tableExists(companionTable))) return false;
  const quoted = q(companionTable, adapter.dialect);
  // Postgres needs CASCADE to also remove the FK constraint the companion owns; MySQL and
  // SQLite reject the keyword. IF EXISTS keeps the statement safe against a concurrent drop.
  const dropSql =
    adapter.dialect === "postgresql"
      ? `DROP TABLE IF EXISTS ${quoted} CASCADE`
      : `DROP TABLE IF EXISTS ${quoted}`;
  // Waits for a companion another database session holds in short tries, then stops with
  // `NEXTLY_TABLE_BUSY` naming it and its holder, rather than holding the delete without bound.
  await runI18nSchemaStatements(
    adapter,
    [dropSql],
    change,
    () => `the drop of table ${JSON.stringify(companionTable)}`
  );
  // Readiness remembers only that a companion exists, and this is one of the two things that
  // makes that false. Forgetting it here rather than at the call sites keeps the memory tied to
  // the statement that invalidates it.
  const { forgetCompanionReadiness } = await import(
    "../runtime/companion-readiness"
  );
  forgetCompanionReadiness(adapter, companionTable);
  return true;
}

/**
 * Drops `<tableName>_locales` and purges the entity's `nextly_i18n_archive` rows and its records
 * of where its translated values came from.
 *
 * Call this BEFORE dropping the entity's main table. Errors propagate: callers drop the
 * main table and delete the registry row only after this resolves, so a failure here
 * surfaces with the entity still fully intact rather than half-deleted.
 */
export async function teardownEntityI18n(
  args: TeardownEntityI18nArgs
): Promise<TeardownEntityI18nResult> {
  const { adapter, slug, tableName } = args;
  // Known exactly when the slug is: the identity type offers both or neither.
  const kind = args.slug === null ? undefined : args.kind;
  const companionDropped = await dropTranslationsTable(
    adapter,
    tableName,
    "the localization teardown"
  );

  // A null slug means the caller could not identify the entity (the catalog sweep), and every row
  // outside the translations table is keyed by kind and slug, so there is no safe row set to
  // remove: the archive, the transition record and the provenance records are left alone rather
  // than removed on a guess about whose they are.
  if (slug === null || kind === undefined) {
    return { companionDropped, archiveRowsPurged: 0, provenanceRowsPurged: 0 };
  }
  // An archive from before rows recorded their kind is brought up to date first, since its rows
  // are removed by kind. That is DDL, which the rows' removal below does not run, so it is done
  // here, where the delete may issue DDL anyway.
  if (await adapter.tableExists(ARCHIVE_TABLE)) {
    await ensureI18nArchive(adapter, adapter.dialect);
  }
  return {
    companionDropped,
    ...(await removeEntityTranslationRows({ adapter, kind, slug })),
  };
}
