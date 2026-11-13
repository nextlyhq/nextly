/**
 * A field group's or a Single's change or delete, written as its migration
 * through the Builder save writer (`writeCollectionSave`), as a collection's is.
 *
 * The services every entry point reaches (the Builder, the REST routes, the
 * Direct API) write here, so a table any of them changes or drops stays on
 * record for the migrations after it. The writer plans the migration and
 * snapshot from the database as it stands, then `apply` (the service's own
 * DDL) makes the change: in development the writer runs it and records the
 * files applied once the database stands as the snapshot says; elsewhere the
 * files are written first and `apply` runs after, for the deploy's
 * `nextly migrate` to find done.
 *
 * @module domains/schema/builder-save/entity-save
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { loadUiSchema } from "../ui-schema/loader";

import {
  checkSaveHistory,
  writeCollectionSave,
  type BuilderSaveSetup,
  type CollectionSave,
  type CollectionSaveDeps,
} from "./collection-save";

/**
 * The writer's dependencies for a service's save, or undefined where no
 * writer is set up or no adapter is registered: the service then makes its
 * change alone, as before the writer.
 */
export function entitySaveDeps(
  setup: BuilderSaveSetup | undefined,
  adapter: DrizzleAdapter | undefined,
  logger: CollectionSaveDeps["logger"]
): CollectionSaveDeps | undefined {
  if (setup === undefined || adapter === undefined) return undefined;
  return {
    ...setup,
    adapter,
    logger,
    // Development runs each file and records it applied, as the Builder does
    // for a collection; elsewhere the deploy's `nextly migrate` does.
    applies: process.env.NODE_ENV === "development",
  };
}

/**
 * The entity as the definition file lists it, or as the registry stored it
 * (`stored`) where the file does not list it yet: what a change or a delete
 * starts from.
 */
export async function previousEntity(
  deps: CollectionSaveDeps,
  kind: "single" | "fieldGroup",
  slug: string,
  stored: UiSchemaEntity
): Promise<UiSchemaEntity> {
  const definition = await loadUiSchema({
    projectRoot: deps.projectRoot,
    uiSchemaFile: deps.config.db.uiSchemaFile,
  });
  const listed = kind === "single" ? definition.singles : definition.components;
  return listed.find(entity => entity.slug === slug) ?? stored;
}

/**
 * The history checks `nextly migrate` runs first, made before anything
 * changes, so a refusal leaves the table as it was. None without a writer.
 */
export async function checkEntitySaveHistory(
  deps: CollectionSaveDeps | undefined
): Promise<void> {
  if (deps !== undefined) await checkSaveHistory(deps);
}

/**
 * `save` written and `apply` run: by the writer in development, which then
 * records the files applied; once they are written elsewhere. A failure of
 * `apply` withdraws them in both. Without a writer,
 * `apply` alone runs. The history was checked first
 * (`checkEntitySaveHistory`).
 *
 * `apply` answers `"partly-applied"` where it changed the database and then
 * failed part way: the files are kept and recorded applied nowhere (see
 * `writeCollectionSave`'s `appliedBy`).
 */
export async function writeEntitySave(
  deps: CollectionSaveDeps | undefined,
  save: CollectionSave,
  apply: () => Promise<unknown>
): Promise<void> {
  if (deps === undefined) {
    await apply();
    return;
  }
  // Only a part-way failure is the writer's to know; anything else `apply`
  // answers is the caller's.
  const run = async () =>
    (await apply()) === "partly-applied" ? "partly-applied" : undefined;
  await writeCollectionSave(deps, save, {
    historyChecked: true,
    // In development the writer runs it and records the files applied;
    // elsewhere it runs once they are written. Either way a failure that
    // changed nothing withdraws them.
    ...(deps.applies ? { appliedBy: run } : { appliedAfter: run }),
  });
}

/**
 * A delete run through `apply` and written as the entity's migration: its
 * tables dropped, as the definition and the snapshots then record them.
 * Without it the snapshots would still hold the tables, and the next
 * migration's drift check would find them missing. The history was checked
 * first.
 */
export async function writeEntityDelete(
  deps: CollectionSaveDeps | undefined,
  removed: {
    kind: "single" | "fieldGroup";
    slug: string;
    /** The entity as the registry stored it, every setting included. */
    stored: UiSchemaEntity;
    /** A Single's junction statements and relationship keys, as they go. */
    junctions?: NonNullable<CollectionSave["junctions"]>;
    keys?: NonNullable<CollectionSave["keys"]>;
  },
  apply: () => Promise<unknown>
): Promise<void> {
  if (deps === undefined) {
    await apply();
    return;
  }
  await writeEntitySave(
    deps,
    {
      kind: removed.kind,
      slug: removed.slug,
      previous: await previousEntity(
        deps,
        removed.kind,
        removed.slug,
        removed.stored
      ),
      entity: null,
      change: "delete",
      ...(removed.junctions === undefined
        ? {}
        : { junctions: removed.junctions }),
      ...(removed.keys === undefined ? {} : { keys: removed.keys }),
    },
    apply
  );
}
