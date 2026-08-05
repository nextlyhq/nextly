/**
 * Provision (create / ADD-DROP columns / drop) a Single's companion `single_<slug>_locales`
 * table out-of-band after a schema apply, then register its runtime table so per-language
 * reads/writes resolve without a restart. The push pipeline excludes companion tables, so every
 * single write/create/apply path that changes the localized field set goes through here.
 *
 * Shared by every path that changes a Single's schema so they stay in lockstep. No-op when the
 * single isn't localized (a non-localized single has no companion). The DDL reconcile throws on
 * failure (data-integrity critical); the runtime registration is best-effort (recovered on next
 * restart).
 *
 * It lives beside the Singles services rather than inside the request handler because the handler
 * is not the only caller: the schema-changing paths that own both the table change and the
 * registry write need the same companion step, and a second copy is how two implementations of
 * one rule drift apart.
 *
 * @module domains/singles/services/reconcile-single-companion
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  getConfigFromDI,
  getSchemaRegistryFromDI,
} from "../../../dispatcher/helpers/di";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../../schemas/nextly-i18n-archive";
import { buildCompanionTransitionStatements } from "../../i18n/migration/reconcile-companion";
import {
  companionHasStatusColumn,
  localizedColumnsOnMain,
} from "../../i18n/runtime/companion-io";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";
import { applyStatements } from "../../schema/services/apply-migration-statements";

/** Everything the companion reconcile needs about the save that triggered it. */
export interface ReconcileSingleCompanionArgs {
  slug: string;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** Localization state AFTER this save (requested). */
  localized: boolean;
  /** Localization state BEFORE this save (persisted). Drives enable/disable detection. */
  wasLocalized: boolean;
  status: boolean;
  /**
   * Whether the single had Draft/Published BEFORE this apply.
   *
   * Separate from `status` because the disable restore asks a different question: not what the
   * single is being saved as, but whether main carried `status` and the companion `_status`
   * beforehand — a copy from columns that were not there fails the whole migration.
   */
  wasStatus: boolean;
  adapter: DrizzleAdapter;
}

export async function reconcileSingleCompanion(
  args: ReconcileSingleCompanionArgs
): Promise<void> {
  const {
    slug,
    tableName,
    oldFields,
    newFields,
    localized,
    status,
    wasStatus,
    adapter,
  } = args;
  const wasLocalized = args.wasLocalized;
  // Nothing to do when the single was and remains non-localized.
  if (!wasLocalized && !localized) return;

  const dialect = adapter.dialect;
  const companionTable = `${tableName}_locales`;
  const companionExists = await adapter.tableExists(companionTable);
  // Only introspect `_status` when it can matter: an existing companion that stays localized
  // (a later Draft/Published toggle must ADD/DROP `_status`).
  const companionHasStatus =
    companionExists && wasLocalized && localized
      ? await companionHasStatusColumn(adapter, companionTable)
      : undefined;

  // The seed (enable) and restore (disable) copy the default-locale value to/from the companion;
  // read the configured default locale (falls back to "en" when localization isn't configured).
  const defaultLocale = getConfigFromDI()?.localization?.defaultLocale ?? "en";

  const plan = buildCompanionTransitionStatements({
    // The companion mirrors the main table, and a single's table comes from the same builder as a collection's.
    builtBy: "collection" as const,
    slug,
    tableName,
    dialect,
    defaultLocale,
    status,
    wasLocalized,
    isLocalized: localized,
    oldFields,
    newFields,
    companionExists,
    companionHasStatus,
    wasStatus,
    // Which translatable columns the main table still carries. A disable must not re-add one that
    // is already there, and must still restore it: presence says the column exists, never that its
    // value is current, because every localized write went to the companion alone.
    existingMainColumns: await localizedColumnsOnMain(
      adapter,
      tableName,
      oldFields
    ).then(cols => cols.map(c => c.name)),
  });

  // A disable archives non-default translations, so ensure `nextly_i18n_archive` exists first
  // (Builder entities have no `nextly migrate` step to provision it). Idempotent.
  if (plan.needsArchive) {
    for (const stmt of getI18nArchiveDdl(dialect)) {
      await adapter.executeQuery(stmt);
    }
    // MySQL's table DDL cannot restore an index the table is missing, and
    // index-only drift produces no reconcile operations, so the repair runs
    // here. Tolerated rather than checked first: attempting it and accepting
    // "duplicate key name" is one round trip instead of two, and the same
    // tolerance the schema executor already applies.
    const indexRepair = getI18nArchiveIndexRepairDdl(dialect);
    if (indexRepair) {
      try {
        await adapter.executeQuery(indexRepair);
      } catch (err) {
        if (!isIdempotencyError(err)) throw err;
      }
    }
  }
  // 🔴 Tolerant, because a create can meet a companion that is already there.
  //
  // Repairing an orphan — main and companion present, the registry row gone — reaches here as a
  // brand-new localized single, since that is all the registry can say: `wasLocalized: false` and
  // no old fields. The plan then asks to ADD every translatable column, and those statements carry
  // no `IF NOT EXISTS` on ANY dialect, so the repair failed everywhere rather than only on MySQL.
  // The same rule the main table gets, from the same matcher, which still refuses a duplicate ROW.
  await applyStatements(adapter, plan.statements);

  // The transition record describes a companion that no longer exists, so it stops being true the
  // moment the disable succeeds. Left behind, it would refuse the next enable's real source locale
  // — the check that protects a live transition would block a legitimate one instead.
  if (plan.companionDropped) {
    // The other half of "this companion is gone": readiness remembers only that one exists.
    const { forgetCompanionReadiness } = await import(
      "../../i18n/runtime/companion-readiness"
    );
    forgetCompanionReadiness(adapter, `${tableName}_locales`);
    const { resolveTransitionStore } = await import(
      "../../i18n/migration/transition-recorder"
    );
    const { forgetI18nTransition } = await import(
      "../../i18n/migration/transition-state"
    );
    await forgetI18nTransition(
      await resolveTransitionStore(adapter),
      "single",
      slug
    );
  }

  // Register the companion runtime table (best-effort — next boot re-registers it). Skipped when
  // the plan dropped the companion (disable) or the single is no longer localized.
  if (!plan.companionDropped && localized) {
    try {
      const companion = buildCompanionRuntimeTable({
        slug,
        tableName,
        fields: newFields,
        dialect,
        localized: true,
        status,
      });
      if (companion) {
        getSchemaRegistryFromDI()?.registerDynamicSchema(
          companion.companionTableName,
          companion.table
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[reconcileSingleCompanion] Companion runtime registration failed for '${slug}': ${msg}.`
      );
    }
  }
}
