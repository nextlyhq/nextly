/**
 * The push a Single's or field group's schema dialog runs: the pipeline the Builder's apply uses,
 * wired with the dialog's answers, and the push itself.
 *
 * One function so the two dialogs cannot build the pipeline or tag the push differently, and so a
 * dialog that pushes twice (a Required or Unique field leaving translation gets its setting in a
 * second push, once its values are shared) runs the same push both times.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { appLocalization } from "../../domains/i18n/configured-locales";
import { fieldsLeavingTranslationUnder } from "../../domains/i18n/migration/archive-preflight";
import {
  companionUniqueIndexChanges,
  companionUniqueIndexName,
  uniqueTranslatedColumns,
} from "../../domains/i18n/migration/companion-unique-indexes";
import {
  type LeavingSettingHeldBack,
  leavingSettingsHeldBackMessage,
} from "../../domains/i18n/migration/field-leaves-translation-rules";
import type { FieldRename } from "../../domains/i18n/migration/reconcile-companion";
import { movedOnto } from "../../domains/schema/pipeline/apply";
import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor";
import { BrowserPromptDispatcher } from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import {
  type PipelineResult,
  PushSchemaPipeline,
} from "../../domains/schema/pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
import { applyMigrationStatements } from "../../domains/schema/services/apply-migration-statements";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { NextlyError } from "../../errors/nextly-error";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

import { getMigrationJournalFromDI } from "./di";

/**
 * A push of a desired schema for the entity `slug`, as its schema dialog applies it.
 *
 * @param args.resolutions - The dialog's answers, as `BrowserPromptDispatcher` takes them: the
 *   renames, the typed resolutions, and the legacy per-field bundle.
 */
export function builderSchemaPush(args: {
  dialect: SupportedDialect;
  db: unknown;
  databaseName: string | undefined;
  slug: string;
  /** Recorded on the journal row, so the entity's history finds it under its own kind. */
  kind: "single" | "component";
  resolutions: ConstructorParameters<typeof BrowserPromptDispatcher>;
}): (desired: DesiredSchema) => Promise<PipelineResult> {
  const { dialect, db } = args;
  const pipeline = new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: new BrowserPromptDispatcher(...args.resolutions),
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: getMigrationJournalFromDI() ?? noopMigrationJournal,
    notifier: getProductionNotifier(),
  });
  return desired =>
    pipeline.apply({
      desired,
      db,
      dialect,
      source: "ui",
      promptChannel: "browser",
      databaseName: args.databaseName,
      uiTargetSlug: args.slug,
      // Named, not defaulted: the scope defaults to a collection, and an entity recorded under
      // that kind is invisible to every history query filtered by its own.
      uiTargetKind: args.kind,
      // A field becoming translated keeps its value as this language's; the apply moves it after
      // its prompts and refusals, before it drops the main column.
      defaultLocale: appLocalization()?.defaultLocale ?? "en",
    });
}

/** What a Single's or field group's companion reconcile is given, beyond the entity's kind. */
export interface BuilderCompanionReconcile {
  slug: string;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** Localization AFTER this save, as the request asks for it. */
  localized: boolean;
  /** Localization BEFORE it, from the persisted record: an enable seeds, a disable restores. */
  wasLocalized: boolean;
  adapter: DrizzleAdapter;
  /** A translated field the admin renamed: the dialog's answer naming the companion. */
  renamed?: FieldRename | undefined;
  /** Draft/Published after and before this save. A field group has neither. */
  status?: boolean;
  wasStatus?: boolean;
}

/**
 * Pushes `desired` for a Single's or field group's dialog, then brings its companion in step.
 *
 * One function because the two are one step in effect, and were written out twice: the push
 * pipeline deliberately excludes `_locales` tables, so every dialog that pushes must reconcile
 * the companion too, and a dialog that paired them differently would leave an entity's
 * translations behind its main table.
 *
 * @throws Error when the push is refused, and `NEXTLY_INTERNAL_ERROR` naming the entity when the
 *   push landed but its companion could not be brought in step.
 */
export async function pushAndReconcileCompanion(
  push: (desired: DesiredSchema) => Promise<PipelineResult>,
  desired: DesiredSchema,
  kind: "single" | "component",
  companion: BuilderCompanionReconcile
): Promise<PipelineResult> {
  await dropLeavingFieldUniqueIndexes(kind, companion);
  const result = await push(desired);
  if (!result.success) {
    // The push's own words, under the code its status already was: what the dialog tells the
    // admin about a refused apply is the only account of it they get.
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: result.error?.message ?? "Failed to apply schema changes",
    });
  }
  // Columns this apply already moved onto the companion, with their values, before its drop, so
  // the reconcile takes them as done rather than adding them again.
  const joinedBefore = movedOnto(result, companion.tableName);
  try {
    if (kind === "single") {
      const { reconcileSingleCompanion } = await import(
        "../../domains/singles/services/reconcile-single-companion"
      );
      await reconcileSingleCompanion({
        ...companion,
        joinedBefore,
        status: companion.status === true,
        wasStatus: companion.wasStatus === true,
      });
    } else {
      const { reconcileComponentCompanion } = await import(
        "../../domains/field-groups/services/field-group-table-provisioning"
      );
      await reconcileComponentCompanion({ ...companion, joinedBefore });
    }
  } catch (error) {
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: {
        op:
          kind === "single"
            ? "singleCompanionReconcile"
            : "componentCompanionReconcile",
        slug: companion.slug,
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return result;
}

/**
 * Drops the per-language unique index of each field leaving translation, before the push.
 *
 * The companion reconcile drops it too, but only after the push, and on SQLite the push may read
 * every table in the database, where an expression index on the companion cannot be read. The
 * index goes with the field's translation in any case; the reconcile reads the live indexes, so it
 * finds it gone rather than dropping it a second time.
 */
async function dropLeavingFieldUniqueIndexes(
  kind: "single" | "component",
  companion: BuilderCompanionReconcile
): Promise<void> {
  if (!companion.wasLocalized || !companion.localized) return;
  const leaving = new Set(
    fieldsLeavingTranslationUnder(
      companion.oldFields,
      companion.newFields,
      companion.renamed
    )
  );
  if (leaving.size === 0) return;
  const dialect = companion.adapter.getCapabilities().dialect;
  const companionTable = `${companion.tableName}_locales`;
  // Each leaving field's index as it is now: keyed on the column the field had before the change,
  // which for a field this change renames is still its old one.
  const renamed = companion.renamed;
  const indexed = uniqueTranslatedColumns({
    fields: companion.oldFields,
    entityLocalized: true,
    dialect,
    builtBy: kind === "component" ? "fieldGroup" : "collection",
  }).filter(c =>
    leaving.has(renamed && c.field === renamed.from ? renamed.to : c.field)
  );
  if (indexed.length === 0) return;
  const { drops } = companionUniqueIndexChanges({
    dialect,
    companionTable,
    wanted: [],
    translatedColumns: indexed.map(c => c.column),
    liveIndexNames: new Set(
      indexed.map(c => companionUniqueIndexName(companionTable, c.column))
    ),
  });
  await applyMigrationStatements(
    companion.adapter,
    drops.join("\n--> statement-breakpoint\n")
  );
}

/**
 * The error for a schema dialog's second push refused: the one that applies the Required and
 * Unique settings of fields leaving translation after their values were shared. By then the first
 * push and the companion transition have run, and the dialog has recorded the fields as the table
 * holds them, shared without those settings. The message names each setting not applied and says
 * that saving again applies it; the database's own reason stays in the log, as it may quote a
 * value.
 */
export function leavingSettingsNotApplied(
  entity: string,
  result: Pick<PipelineResult, "error">,
  heldBack: readonly LeavingSettingHeldBack[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: leavingSettingsHeldBackMessage(heldBack),
    logContext: {
      op: "leavingFieldSettings",
      entity,
      detail: result.error?.message,
      heldBack,
    },
  });
}
