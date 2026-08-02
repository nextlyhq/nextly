import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor";
import { BrowserPromptDispatcher } from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { NextlyError } from "../../errors";
import { getProductionNotifier } from "../../runtime/notifications/index";

import { buildFullDesiredSchema } from "./desired-schema";
import { getMigrationJournalFromDI } from "./di";

/**
 * Legacy resolutions a Schema Builder SAVE carries and a CREATE never does.
 *
 * A create has nothing to rename and no prior shape to reconcile, so every field here is absent on
 * that path. They are named rather than spread so a caller cannot pass a save's payload to a create
 * by accident.
 */
export interface BuilderPromptResolutions {
  renameResolutions?: ConstructorParameters<typeof BrowserPromptDispatcher>[0];
  eventResolutions?: ConstructorParameters<typeof BrowserPromptDispatcher>[1];
  legacyBundle?: ConstructorParameters<typeof BrowserPromptDispatcher>[2];
}

export interface ApplyBuilderSchemaArgs extends BuilderPromptResolutions {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  /** Scopes the journal row to the entity the operator acted on. */
  slug: string;
  /**
   * States this entity's desired shape on the schema the diff will run against.
   *
   * A mutator rather than a value because the entity being created is not in the registry yet, so
   * it cannot be read back out of the built schema — it has to be written in.
   */
  apply: (desired: DesiredSchema) => void;
}

/**
 * Converge the database on the shape the Schema Builder just declared.
 *
 * 🔴 The single seam through which Builder-authored DDL reaches a database. Before it, creating an
 * entity generated its own SQL and executed it directly while editing one went through the shared
 * pipeline — so the same field type could produce two different columns depending on which action
 * made it, a created table could disagree with an identical code-first definition on indexes, and
 * a create left no row in the schema journal at all.
 *
 * It is also what makes the Builder's writes lockable. DDL arriving through one function can be
 * excluded for the duration of a storage migration; DDL emitted from three handlers cannot.
 */
export async function applyBuilderSchema(
  args: ApplyBuilderSchemaArgs
): Promise<void> {
  const { adapter, dialect, slug } = args;
  const db = adapter.getDrizzle();

  const desired = await buildFullDesiredSchema();
  args.apply(desired);

  const pipeline = new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: new BrowserPromptDispatcher(
      args.renameResolutions ?? [],
      args.eventResolutions ?? [],
      args.legacyBundle
    ),
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    // Falls back to the noop only on a very early boot, before DI has registered one. A create that
    // silently went unjournaled is the hole this function exists to close, so the fallback is the
    // exception rather than the shape of the call.
    migrationJournal: getMigrationJournalFromDI() ?? noopMigrationJournal,
    notifier: getProductionNotifier(),
  });

  const result = await pipeline.apply({
    desired,
    db,
    dialect,
    source: "ui",
    promptChannel: "browser",
    // MySQL's pushSchema needs the database name; the other dialects ignore it.
    databaseName:
      dialect === "mysql"
        ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
        : undefined,
    uiTargetSlug: slug,
  });

  if (!result.success) {
    throw NextlyError.internal({
      logContext: {
        reason: "builder_schema_apply_failed",
        slug,
        detail: result.error?.message,
      },
    });
  }
}
