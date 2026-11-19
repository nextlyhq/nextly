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
import type {
  BuilderSaveSetup,
  CollectionSave,
  CollectionSaveDeps,
  CollectionSavePreview,
} from "../../domains/schema/builder-save/collection-save";
import { partWayPush } from "../../domains/schema/builder-save/landing-push";
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../../domains/schema/builder-save/schema-change-save";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { NextlyError } from "../../errors/nextly-error";
import type { UiSchemaEntity } from "../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { consoleLogger } from "../../shared/types";

import { getAdapterFromDI, getLoggerFromDI } from "./di";

/**
 * The Builder save writer, loaded where a save runs: it brings the migration
 * generator and runner, which a dispatcher that saves no schema never needs.
 */
const loadCollectionSave = () =>
  import("../../domains/schema/builder-save/collection-save");
const loadEntitySave = () =>
  import("../../domains/schema/builder-save/entity-save");

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
  if (deps === undefined) return;
  const { checkSaveHistory } = await loadCollectionSave();
  await checkSaveHistory(deps);
}

/**
 * Apply a change through `apply` (the dialog's push) and write it as the
 * entity's migration: in development the writer runs `apply` and records the
 * files applied, or runs the files themselves where `fileRoad` says the push
 * carries no values; elsewhere it writes them and `apply` runs after, as the
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
    /** A Single's junction statements and relationship keys (`entityRelations`). */
    junctions?: NonNullable<CollectionSave["junctions"]>;
    keys?: NonNullable<CollectionSave["keys"]>;
  },
  /**
   * Whether `apply`'s push has landed (`landingPush`): a failure after it,
   * such as a companion reconcile, leaves the main table changed, so the
   * files describing that change are kept, recorded applied nowhere, and the
   * failure is thrown saying the database holds part of the change, naming
   * the kept files and what to run next.
   */
  landed?: () => boolean,
  /**
   * The save's own migration file in place of `apply` in development, where `pushWhen` answers
   * false (`pushCarriesValues`): the writer runs it as `nextly migrate` runs one, in tries over a
   * busy table and on SQLite with foreign keys off, and records it applied; `afterFile` then
   * brings what the file does not reach in step (the companion's reconcile, planned from the
   * companion as the file left it). A failure of `afterFile` leaves the file recorded applied.
   *
   * `registry`, the caller's registry write for the save, runs inside the last file's
   * transaction, after its ledger row, so the change and the row the registry keeps of it commit
   * or roll back together, and a failed write leaves the save as it was. On every other road the
   * caller writes it after this returns.
   */
  fileRoad?: {
    pushWhen: () => Promise<boolean>;
    afterFile: () => Promise<void>;
    /**
     * The questions the push asks before it changes anything, asked of the save's file where it
     * runs instead, before anything is written: a rename the request does not answer, or a drop it
     * does not confirm, refuses the save as the push refuses it (`refuseUnansweredDialogQuestions`).
     */
    questions?: () => Promise<void>;
    registry?: () => Promise<void>;
  }
): Promise<{ registryWritten: boolean }> {
  if (deps === undefined) {
    await apply();
    return { registryWritten: false };
  }
  // Asked before the save writes anything, as a change reaching a relation's storage is judged
  // against the live table; only where the answer is used, a save the writer runs.
  const runsFile =
    deps.applies && fileRoad !== undefined && !(await fileRoad.pushWhen());
  // Outside development the push runs after the files are written (`appliedAfter`) and asks only of
  // the main table's columns, while the translations table's and the link tables' drops follow it:
  // the questions are asked there too, before anything is written, as the collection's road asks.
  if (runsFile || !deps.applies) await fileRoad?.questions?.();
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
  const { writeEntitySave } = await loadEntitySave();
  if (runsFile) {
    await writeEntitySave(deps, save, apply, {
      runsFile: true,
      ...(fileRoad.registry === undefined
        ? {}
        : { inLastTransaction: fileRoad.registry }),
    });
    await fileRoad.afterFile();
    return { registryWritten: fileRoad.registry !== undefined };
  }
  // A failure after the push landed keeps the files, and is told as a collection's is: what the
  // database holds, the files kept and what to run next (`partWayPush`).
  const pushed = partWayPush(async onLanded => {
    try {
      await apply();
    } finally {
      if (landed?.() === true) onLanded();
    }
  });
  const written = await writeEntitySave(deps, save, pushed.appliedBy);
  pushed.throwIfFailed(written?.files ?? []);
  return { registryWritten: false };
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
): Promise<BuilderSaveReview> {
  if (deps === undefined) return NOTHING_TO_REVIEW;
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
  const { previewCollectionSave } = await loadCollectionSave();
  return reviewOf(await previewCollectionSave(deps, save));
}

/**
 * What a save's review shows beside the change: each line, and each conversion by the key its
 * apply confirms it by (`acknowledgedConversions`), which the Builder sends back once the person
 * confirms the review.
 */
export type BuilderSaveReview = Pick<
  CollectionSavePreview,
  "notices" | "conversions"
>;

/** The review of a save with no writer: nothing beyond the change. */
export const NOTHING_TO_REVIEW: BuilderSaveReview = {
  notices: [],
  conversions: [],
};

/** The review a save's preview gives. */
export function reviewOf(preview: CollectionSavePreview): BuilderSaveReview {
  return { notices: preview.notices, conversions: preview.conversions };
}
