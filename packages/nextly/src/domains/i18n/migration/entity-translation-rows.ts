/**
 * The rows a deleted entity's translations leave outside its translations table, removed by the
 * entity's kind and slug: its rows in the shared `nextly_i18n_archive`, its record of a translation
 * transition in `nextly_meta`, and its records of where its translated values came from.
 *
 * Rows only, and no DDL, so a caller can remove them on a transaction it holds with other rows of
 * the same entity, all or none, on every dialect (MySQL commits a transaction at any DDL). The
 * translations table itself is a table, dropped by the entity's delete (`teardownEntityI18n`, or
 * its migration).
 *
 * One precondition, because bringing the archive up to date is DDL: where the archive table exists,
 * it records each row's entity kind (`ensureI18nArchive` has run on it), since the archive's rows
 * are removed by kind as well as slug.
 *
 * Each table is asked about first, and a missing one is passed over: the archive is created lazily,
 * the transition record lives in a table core setup makes, and the provenance table reaches an
 * installation through `nextly migrate`. Their absence must not block a delete.
 *
 * @module domains/i18n/migration/entity-translation-rows
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";
import {
  TRANSLATION_PROVENANCE_TABLE,
  translationProvenanceTables,
} from "../../../schemas/translation-provenance";
import { affectedRowCount } from "../../auth/services/auth-service";

import { labelLegacyArchiveRows } from "./label-legacy-archive-rows";
import type { I18nTransitionKind } from "./transition-state";

/** The shared archive table, scoped per entity by its `collection` column. */
export const ARCHIVE_TABLE = "nextly_i18n_archive";

/** Where the transition record lives. Absent on a database that never completed core setup. */
const META_TABLE = "nextly_meta";

/**
 * The slice of Drizzle these removals drive: a single scoped DELETE. Declaring only what is used
 * keeps the dialect-specific database type out of the port, so no `any` is needed.
 */
interface RowDeleteCapableDb {
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** The adapter surface the removals need, which `DrizzleAdapter` and a transaction's view satisfy. */
export interface TranslationRowsAdapter {
  dialect: SupportedDialect;
  tableExists(tableName: string): Promise<boolean>;
  /** Which tables exist, for finding the field-group registry's name when labelling older rows. */
  listTables(): Promise<string[]>;
  getDrizzle<T = unknown>(): T;
}

/** How many rows each removal took. */
export interface RemovedTranslationRows {
  /** Archive rows removed (0 when the archive table does not exist). */
  archiveRowsPurged: number;
  /**
   * Records of where its translated values came from, removed (0 when the table does not exist,
   * or for a field group, which keeps none).
   */
  provenanceRowsPurged: number;
  /** Its translation transition record, removed: 1, or 0 where it had none. */
  transitionRecordsPurged: number;
}

/**
 * Remove `kind` `slug`'s archive rows, its translation transition record and its provenance
 * records, in that order. Scoped by kind as well as slug throughout: a collection, a Single and a
 * field group may share a slug, and the shared tables hold every entity's rows.
 */
export async function removeEntityTranslationRows(args: {
  adapter: TranslationRowsAdapter;
  kind: I18nTransitionKind;
  slug: string;
}): Promise<RemovedTranslationRows> {
  const { adapter, kind, slug } = args;

  let archiveRowsPurged = 0;
  if (await adapter.tableExists(ARCHIVE_TABLE)) {
    // An archive from before rows recorded their kind has rows whose owner is known only from the
    // registries. They are labelled first, while this entity's registry row still answers for its
    // slug, and a row whose owner stays unknown is kept: deleting it could take another entity's
    // translations.
    await labelLegacyArchiveRows(adapter);
    const db = adapter.getDrizzle<RowDeleteCapableDb>();
    const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);
    const result = await db
      .delete(nextlyI18nArchive)
      .where(
        and(
          eq(nextlyI18nArchive.collection, slug),
          eq(nextlyI18nArchive.entityKind, kind)
        )
      );
    // Each driver reports the count in a different place, and mysql2 nests it inside a result
    // tuple, so the shared dialect-aware reader owns that knowledge.
    archiveRowsPurged = affectedRowCount(result, adapter.dialect);
  }

  // The transition record is keyed by kind and slug, both of which a later entity can reuse: left
  // behind, it would hand that entity a predecessor's source locale and refuse its real one.
  let transitionRecordsPurged = 0;
  if (await adapter.tableExists(META_TABLE)) {
    const { resolveTransitionStore } = await import("./transition-recorder");
    const { forgetI18nTransition } = await import("./transition-state");
    const forgot = await forgetI18nTransition(
      await resolveTransitionStore(adapter),
      kind,
      slug
    );
    transitionRecordsPurged = forgot ? 1 : 0;
  }

  // Where each translated value came from is kept per collection or Single, by kind and slug. Left
  // behind, a later entity of the same kind and slug would read a predecessor's origins.
  let provenanceRowsPurged = 0;
  if (
    (kind === "collection" || kind === "single") &&
    (await adapter.tableExists(TRANSLATION_PROVENANCE_TABLE))
  ) {
    const db = adapter.getDrizzle<RowDeleteCapableDb>();
    const { nextlyTranslationProvenance } = translationProvenanceTables(
      adapter.dialect
    );
    const result = await db
      .delete(nextlyTranslationProvenance)
      .where(
        and(
          eq(nextlyTranslationProvenance.scopeKind, kind),
          eq(nextlyTranslationProvenance.scopeSlug, slug)
        )
      );
    provenanceRowsPurged = affectedRowCount(result, adapter.dialect);
  }

  return { archiveRowsPurged, provenanceRowsPurged, transitionRecordsPurged };
}
