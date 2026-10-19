/**
 * The push a Single's or field group's schema dialog runs: the pipeline the Builder's apply uses,
 * wired with the dialog's answers, and the push itself.
 *
 * One function so the two dialogs cannot build the pipeline or tag the push differently, and so a
 * dialog that pushes twice (a Required or Unique field leaving translation gets its setting in a
 * second push, once its values are shared) runs the same push both times.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

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
import { getProductionNotifier } from "../../runtime/notifications/index";

import { getConfigFromDI, getMigrationJournalFromDI } from "./di";

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
      defaultLocale: getConfigFromDI()?.localization?.defaultLocale ?? "en",
    });
}
