/**
 * A Single's or a field group's Builder field change, written as its
 * migration through the Builder save writer (`writeCollectionSave`), as a
 * collection's is.
 *
 * Their schema dialogs apply a change with their own push, which knows their
 * translation steps. The writer plans the change's migration and snapshot
 * first, from the database as it stands, so a table no migration records yet
 * is adopted as it is before the change; the push then applies it, and in
 * development the writer records the files applied once the database stands
 * as the snapshot says. So every table a Builder save changes is on record for
 * the migrations after it. The history checks `nextly migrate` runs first are
 * made before anything, so a refusal leaves the table as it was.
 *
 * @module dispatcher/helpers/builder-save-change
 */
import { container } from "../../di/container";
import {
  checkSaveHistory,
  previewCollectionSave,
  type BuilderSaveSetup,
  type CollectionSave,
  type CollectionSaveDeps,
} from "../../domains/schema/builder-save/collection-save";
import { writeEntitySave } from "../../domains/schema/builder-save/entity-save";
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../../domains/schema/builder-save/schema-change-save";
import type { PipelineResult } from "../../domains/schema/pipeline/pushschema-pipeline";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { NextlyError } from "../../errors/nextly-error";
import type { UiSchemaEntity } from "../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { consoleLogger } from "../../shared/types";

import { getAdapterFromDI, getLoggerFromDI } from "./di";

/** The writer's dependencies, or undefined where the app registered no writer. */
export function builderSaveDeps(): CollectionSaveDeps | undefined {
  if (!container.has("builderSaveSetup")) return undefined;
  const setup = container.get<BuilderSaveSetup>("builderSaveSetup");
  const adapter = getAdapterFromDI();
  if (!adapter) {
    throw NextlyError.internal({
      logContext: { reason: "database adapter not initialized" },
    });
  }
  return {
    ...setup,
    adapter,
    logger: getLoggerFromDI() ?? consoleLogger,
    // Development records each file applied, as the Builder does for a
    // collection; elsewhere the deploy's `nextly migrate` applies them.
    applies: process.env.NODE_ENV === "development",
  };
}

/**
 * The history checks a save makes before anything changes: an applied file
 * edited or missing, or an attempt left unfinished, refuses it.
 */
export async function checkBuilderSaveHistory(
  deps: CollectionSaveDeps | undefined
): Promise<void> {
  if (deps !== undefined) await checkSaveHistory(deps);
}

/**
 * Apply a change through `apply` (the dialog's push) and write it as the
 * entity's migration: in development the writer runs `apply` and records the
 * files applied; elsewhere it writes them and `apply` runs after, as the
 * dialog applies a change today, for the deploy's `nextly migrate` to find
 * done. Without a writer, `apply` alone runs. The history was checked first.
 */
export async function writeBuilderSchemaChange(
  deps: CollectionSaveDeps | undefined,
  apply: () => Promise<unknown>,
  change: {
    kind: "single" | "fieldGroup";
    slug: string;
    table: string;
    /**
     * The entity as the registry stores it, every setting included: what the
     * save starts from where the definition file does not list it yet.
     */
    stored: UiSchemaEntity;
    fields: readonly FieldDefinition[];
    localized: boolean;
    answers: SchemaChangeAnswers;
    /** A Single's junction statements and relationship keys (`singleRelations`). */
    junctions?: NonNullable<CollectionSave["junctions"]>;
    keys?: NonNullable<CollectionSave["keys"]>;
  },
  /**
   * Whether `apply`'s push has landed (`landingPush`): a failure after it,
   * such as a companion reconcile, leaves the main table changed, so the
   * files describing that change are kept, recorded applied nowhere, and the
   * failure is still thrown.
   */
  landed?: () => boolean
): Promise<void> {
  if (deps === undefined) {
    await apply();
    return;
  }
  const { save } = saveOfSchemaChange({
    ...change,
    row: {
      labels: change.stored.labels,
      fields: change.stored.fields as unknown as FieldDefinition[],
    },
    definition: await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
  });
  // Held in an object, as the apply below sets it from inside the writer.
  const failed: { error?: unknown } = {};
  await writeEntitySave(deps, save, async () => {
    try {
      await apply();
      return undefined;
    } catch (error) {
      if (landed?.() !== true) throw error;
      failed.error = error;
      return "partly-applied";
    }
  });
  if ("error" in failed) throw failed.error;
}

/**
 * A schema dialog's push that notes once one of its pushes has landed, for
 * `writeBuilderSchemaChange` to tell a failure before the main table changed
 * from one after it.
 */
export function landingPush(
  push: (desired: DesiredSchema) => Promise<PipelineResult>
): {
  push: (desired: DesiredSchema) => Promise<PipelineResult>;
  landed: () => boolean;
} {
  let landed = false;
  return {
    push: async desired => {
      const result = await push(desired);
      if (result.success) landed = true;
      return result;
    },
    landed: () => landed,
  };
}

/**
 * What the save would write beyond the person's change, for the schema
 * dialog's review to show before they confirm: each conversion an adoption
 * makes, each fill and each delete (`previewCollectionSave`). A conversion
 * shown here is one the dialog can acknowledge, which the save then writes.
 * None without a writer.
 */
export async function reviewBuilderSchemaChange(
  deps: CollectionSaveDeps | undefined,
  change: Parameters<typeof writeBuilderSchemaChange>[2]
): Promise<string[]> {
  if (deps === undefined) return [];
  const { save } = saveOfSchemaChange({
    ...change,
    row: {
      labels: change.stored.labels,
      fields: change.stored.fields as unknown as FieldDefinition[],
    },
    definition: await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
  });
  return (await previewCollectionSave(deps, save)).notices;
}
