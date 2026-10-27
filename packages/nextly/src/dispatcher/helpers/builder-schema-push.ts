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
import {
  fieldsLeavingTranslationUnder,
  refuseLeavingSettingsTheValuesCannotTake,
} from "../../domains/i18n/migration/archive-preflight";
import {
  type LeavingFieldLike,
  leavingFieldConstraints,
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
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import type { ColumnOrigin } from "../../domains/schema/services/field-column-descriptor";
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
  /**
   * The settings step of Required or Unique fields leaving translation (`leavingSettingsStep`),
   * run once their values are copied onto main and before their companion columns are dropped.
   */
  settleLeaving?: () => Promise<void>;
}

/**
 * Pushes `desired` for a Single's or field group's dialog, then brings its companion in step.
 *
 * One function because the two are one step in effect, and were written out twice: the push
 * pipeline deliberately excludes `_locales` tables, so every dialog that pushes must reconcile
 * the companion too, and a dialog that paired them differently would leave an entity's
 * translations behind its main table.
 *
 * @throws Error when the push is refused; the settings step's own refusal as it is, the fields
 *   still translated; and `NEXTLY_INTERNAL_ERROR` naming the entity when the push landed but its
 *   companion could not be brought in step.
 */
export async function pushAndReconcileCompanion(
  push: (desired: DesiredSchema) => Promise<PipelineResult>,
  desired: DesiredSchema,
  kind: "single" | "component",
  companion: BuilderCompanionReconcile
): Promise<PipelineResult> {
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
    // A refused setting is the dialog's answer to the admin, naming the field, and nothing has
    // been dropped by then, so it is passed on as it is rather than as a companion out of step.
    if (isLeavingSettingsRefusal(error)) throw error;
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
 * The settings step a schema dialog runs between copying the values of Required or Unique fields
 * leaving translation onto main and dropping their companion columns: whether those values can
 * take the settings, asked again right before they are applied, then the push of the real fields.
 * Either refusal leaves the fields translated, every language in place, so the dialog can be saved
 * again as it was.
 */
export function leavingSettingsStep(args: {
  adapter: DrizzleAdapter;
  entity: string;
  tableName: string;
  builtBy: ColumnOrigin;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  renamed?: FieldRename | null;
  /** The push of the fields with their settings. */
  push: () => Promise<Pick<PipelineResult, "success" | "error">>;
}): () => Promise<void> {
  return async () => {
    try {
      await refuseLeavingSettingsTheValuesCannotTake({
        ...args,
        defaultLocale: appLocalization()?.defaultLocale ?? "en",
      });
      const settled = await args.push();
      if (!settled.success) throw leavingSettingsNotApplied(args, settled);
    } catch (error) {
      if (error instanceof Error) leavingSettingsRefusals.add(error);
      throw error;
    }
  };
}

/** The errors a settings step (`leavingSettingsStep`) refused with. */
const leavingSettingsRefusals = new WeakSet<Error>();

/**
 * Whether `error` is a settings step's refusal, which a caller passes on as it is: nothing has
 * been dropped by then, and it names the fields.
 */
export function isLeavingSettingsRefusal(error: unknown): boolean {
  return error instanceof Error && leavingSettingsRefusals.has(error);
}

/**
 * Refuses a Single's schema save whose leaving settings the database refused. The record already
 * holds the fields without them, as the table does, so the error tells the admin which setting on
 * which field was not applied and that saving again applies it. Nothing when none was refused.
 */
export function refuseRefusedLeavingSettings(
  entity: string,
  refused: readonly { field: string; setting: "required" | "unique" }[]
): void {
  if (refused.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage:
      `The fields were saved as shared, but the database refused ${namedLeavingSettings(refused)} ` +
      "once the values were shared, so the fields were saved without them. Save again to apply them.",
    logContext: { op: "leavingFieldSettings", entity },
  });
}

/** Each setting by name and field, as "Required on code and Unique on code". */
function namedLeavingSettings(
  settings: readonly { field: string; setting: "required" | "unique" }[]
): string {
  return settings
    .map(
      s => `${s.setting === "required" ? "Required" : "Unique"} on ${s.field}`
    )
    .join(" and ");
}

/**
 * The error for a schema dialog's settings step refused by the database, after its values were
 * judged able to take them: an entry written in between, or a refusal of the database's own. It
 * names each setting and field, which are the admin's own schema, and says the fields are still
 * translated; the database's reason goes to the log.
 */
function leavingSettingsNotApplied(
  args: {
    entity: string;
    oldFields: readonly LeavingFieldLike[];
    newFields: readonly LeavingFieldLike[];
    renamed?: FieldRename | null;
  },
  result: Pick<PipelineResult, "error">
): NextlyError {
  const leaving = new Set(
    fieldsLeavingTranslationUnder(args.oldFields, args.newFields, args.renamed)
  );
  const constrained = args.newFields.filter(
    f => leaving.has(f.name) && leavingFieldConstraints(f, undefined).length > 0
  );
  const settings = constrained.flatMap(f =>
    leavingFieldConstraints(f, undefined).map(setting => ({
      field: f.name,
      setting,
    }))
  );
  const still = constrained.length === 1 ? "The field is" : "The fields are";
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage:
      `The database refused ${namedLeavingSettings(settings)} once the values were shared. ` +
      `${still} still translated, with every language kept; save again to apply the change.`,
    logContext: {
      op: "leavingFieldSettings",
      entity: args.entity,
      detail: result.error?.message,
    },
  });
}
