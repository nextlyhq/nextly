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
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../../domains/schema/builder-save/schema-change-save";
import type { FieldMoveRequest } from "../../domains/schema/field-moves/check-move";
import { refuseMovesOffTheFile } from "../../domains/schema/field-moves/moves-road";
import type { PipelineResult } from "../../domains/schema/pipeline/pushschema-pipeline";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
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
    /** The fields the save moves into or out of a group, whose values its file keeps. */
    moves?: readonly FieldMoveRequest[];
  },
  /**
   * Whether `apply`'s push has landed (`landingPush`): a failure after it,
   * such as a companion reconcile, leaves the main table changed, so the
   * files describing that change are kept, recorded applied nowhere, and the
   * failure is still thrown.
   */
  landed?: () => boolean,
  /**
   * The save's own migration file in place of `apply` in development, where `pushWhen` answers
   * false (`pushCarriesValues`): the writer runs it as `nextly migrate` runs one, in tries over a
   * busy table and on SQLite with foreign keys off, and records it applied; `afterFile` then
   * brings what the file does not reach in step (the companion's reconcile, planned from the
   * companion as the file left it). A failure of `afterFile` leaves the file recorded applied.
   */
  fileRoad?: {
    pushWhen: () => Promise<boolean>;
    afterFile: () => Promise<void>;
  }
): Promise<void> {
  // Asked at most once: it reads the live table.
  let pushes: Promise<boolean> | undefined;
  const pushesNow = () =>
    (pushes ??= fileRoad === undefined ? Promise.resolve(true) : fileRoad.pushWhen());
  // A save that moves fields keeps their values only through its own file: one the push would
  // apply instead is refused before anything is written, in every environment alike.
  await refuseMovesOffTheFile({
    moves: change.moves ?? [],
    writes: deps !== undefined,
    pushReason: async () => ((await pushesNow()) ? "carries-values" : null),
  });
  if (deps === undefined) {
    await apply();
    return;
  }
  // Asked before the save writes anything, as a change reaching a relation's storage is judged
  // against the live table; only where the answer is used, a save the writer runs.
  const runsFile =
    deps.applies && fileRoad !== undefined && !(await pushesNow());
  const save = withMoves(saveOfSchemaChange({
    ...change,
    row: {
      labels: change.stored.labels,
      fields: change.stored.fields as unknown as FieldDefinition[],
    },
    definition: await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
  }).save, change.moves);
  const { writeEntitySave } = await loadEntitySave();
  if (runsFile) {
    await writeEntitySave(deps, save, apply, { runsFile: true });
    await fileRoad.afterFile();
    return;
  }
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

/** The save with the fields it moves, whose statements its file carries; as it was without any. */
function withMoves(
  save: CollectionSave,
  moves: readonly FieldMoveRequest[] | undefined
): CollectionSave {
  return moves === undefined || moves.length === 0 ? save : { ...save, moves };
}

/**
 * A schema dialog's push that notes once one of its pushes may have changed
 * the database, for `writeBuilderSchemaChange` to tell a failure before the
 * main table changed from one after it: a push that succeeded, and on MySQL
 * any push at all, since MySQL commits each schema statement as it runs, so
 * a push refused part way may have left some of them applied.
 */
export function landingPush(
  push: (desired: DesiredSchema) => Promise<PipelineResult>,
  dialect: "postgresql" | "mysql" | "sqlite"
): {
  push: (desired: DesiredSchema) => Promise<PipelineResult>;
  landed: () => boolean;
} {
  let landed = false;
  return {
    push: async desired => {
      try {
        const result = await push(desired);
        if (result.success || dialect === "mysql") landed = true;
        return result;
      } catch (error) {
        if (dialect === "mysql") landed = true;
        throw error;
      }
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
): Promise<BuilderSaveReview> {
  if (deps === undefined) return NOTHING_TO_REVIEW;
  const save = withMoves(saveOfSchemaChange({
    ...change,
    row: {
      labels: change.stored.labels,
      fields: change.stored.fields as unknown as FieldDefinition[],
    },
    definition: await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
  }).save, change.moves);
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
