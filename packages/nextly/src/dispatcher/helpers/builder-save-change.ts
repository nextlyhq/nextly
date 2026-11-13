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
  writeCollectionSave,
  type BuilderSaveSetup,
  type CollectionSaveDeps,
} from "../../domains/schema/builder-save/collection-save";
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../../domains/schema/builder-save/schema-change-save";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { NextlyError } from "../../errors/nextly-error";
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
    row: {
      labels?: { singular: string; plural: string };
      fields?: FieldDefinition[];
    };
    fields: readonly FieldDefinition[];
    localized: boolean;
    answers: SchemaChangeAnswers;
  }
): Promise<void> {
  if (deps === undefined) {
    await apply();
    return;
  }
  const { save } = saveOfSchemaChange({
    ...change,
    definition: await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
  });
  await writeThenApply(deps, save, apply);
}

/**
 * The save written, and `apply` run: by the writer in development, which then
 * records the files applied; after the writer elsewhere.
 */
async function writeThenApply(
  deps: CollectionSaveDeps,
  save: Parameters<typeof writeCollectionSave>[1],
  apply: () => Promise<unknown>
): Promise<void> {
  if (deps.applies) {
    await writeCollectionSave(deps, save, {
      historyChecked: true,
      // What `apply` answers is the caller's; the writer only waits on it.
      appliedBy: async () => {
        await apply();
      },
    });
    return;
  }
  await writeCollectionSave(deps, save, { historyChecked: true });
  await apply();
}

/**
 * Delete through `apply` (the Builder's own delete) and write it as the
 * entity's migration: its table dropped, as the definition and snapshots then
 * record it. Without it the snapshots would still hold the table, and the
 * next migration's drift check would find it missing. The history was
 * checked first.
 */
export async function writeBuilderDelete(
  deps: CollectionSaveDeps | undefined,
  apply: () => Promise<unknown>,
  removed: {
    kind: "single" | "fieldGroup";
    slug: string;
    row: {
      labels?: { singular: string; plural: string };
      fields?: FieldDefinition[];
    };
  }
): Promise<void> {
  if (deps === undefined) {
    await apply();
    return;
  }
  const definition = await loadUiSchema({
    projectRoot: deps.projectRoot,
    uiSchemaFile: deps.config.db.uiSchemaFile,
  });
  const listed =
    removed.kind === "single" ? definition.singles : definition.components;
  const previous = listed.find(entity => entity.slug === removed.slug) ?? {
    slug: removed.slug,
    labels: removed.row.labels ?? {
      singular: removed.slug,
      plural: removed.slug,
    },
    fields: removed.row.fields ?? [],
  };
  await writeThenApply(
    deps,
    {
      kind: removed.kind,
      slug: removed.slug,
      previous,
      entity: null,
      change: "delete",
    },
    apply
  );
}
