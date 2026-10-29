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

import { getSchemaRegistryFromDI } from "../../../dispatcher/helpers/di";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { consoleLogger } from "../../../shared/types";
import { appLocalization } from "../../i18n/configured-locales";
import { applyCompanionTransition } from "../../i18n/migration/held-leaving-drops";
import {
  buildCompanionTransitionStatements,
  type FieldRename,
} from "../../i18n/migration/reconcile-companion";
import { refuseUnindexableTranslatedUnique } from "../../i18n/migration/translated-unique-preconditions";
import {
  companionHasStatusColumn,
  liveCompanionShape,
} from "../../i18n/runtime/companion-io";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";

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
  /**
   * Fields joining translation whose companion columns the caller added and filled before the main
   * table changed (`moveValuesOfFieldsJoiningTranslation`). Their ADD is not repeated.
   */
  joinedBefore?: readonly string[];
  /** A translated field this change renames, by field name; its companion column is renamed. */
  renamed?: FieldRename;
  /**
   * Applies the Required and Unique settings of fields leaving translation, once their values are
   * copied onto main and before their companion columns are dropped (`settleThenDropLeavingFields`),
   * throwing when they are refused. Left out, each column is dropped right after its copy.
   */
  settleLeaving?: () => Promise<void>;
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
  const defaultLocale = appLocalization()?.defaultLocale ?? "en";

  // A translated field made unique is refused before any DDL on a server that cannot key its index.
  refuseUnindexableTranslatedUnique(adapter, {
    entity: slug,
    builtBy: "collection",
    oldFields,
    newFields,
    wasLocalized,
    isLocalized: localized,
  });

  const plan = buildCompanionTransitionStatements({
    // The companion mirrors the main table, and a single's table comes from the same builder as a collection's.
    builtBy: "collection" as const,
    slug,
    kind: "single",
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
    joinedBefore: args.joinedBefore,
    renamed: args.renamed,
    holdLeavingDrops: args.settleLeaving !== undefined,
    // What this database holds now, so a re-save after a part-applied one finishes it.
    ...(await liveCompanionShape(adapter, {
      tableName,
      oldFields,
      newFields,
      builtBy: "collection",
      companionExists,
    })),
  });

  await applyCompanionTransition({
    adapter,
    plan,
    settleLeaving: args.settleLeaving,
    kind: "single",
    slug,
    tableName,
  });

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
      consoleLogger.warn(
        `[reconcileSingleCompanion] Companion runtime registration failed for '${slug}': ${msg}.`
      );
    }
  }
}
