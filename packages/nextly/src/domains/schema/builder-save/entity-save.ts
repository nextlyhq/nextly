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
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { loadUiSchema } from "../ui-schema/loader";

import {
  checkSaveHistory,
  writeCollectionSave,
  type CollectionSave,
  type CollectionSaveDeps,
  type CollectionSaveResult,
} from "./collection-save";

// Kept in a module of its own, so a service can tell whether it has a writer
// without loading the writer.
export { entitySaveDeps } from "./entity-save-deps";

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
 * `apply` alone runs. With `runsFile`, development runs the files instead of
 * `apply`. The history was checked first (`checkEntitySaveHistory`).
 *
 * `apply` answers `"partly-applied"` where it changed the database and then
 * failed part way: the files are kept and recorded applied nowhere (see
 * `writeCollectionSave`'s `appliedBy`). The files the writer wrote are
 * answered, in run order, so a caller can name the ones a part-way failure
 * kept; none without a writer.
 */
export async function writeEntitySave(
  deps: CollectionSaveDeps | undefined,
  save: CollectionSave,
  apply: () => Promise<unknown>,
  options: {
    /**
     * In development, the writer runs the files themselves in place of
     * `apply`, as `nextly migrate` runs them: in tries over a busy table,
     * stopping with `NEXTLY_TABLE_BUSY` and the files withdrawn, and on SQLite
     * with foreign keys off and the dangling-reference check after. Elsewhere
     * `apply` still runs once they are written.
     */
    runsFile?: boolean;
    /**
     * With `runsFile`, work done inside the last file's transaction, after its ledger row (the
     * writer's `inLastTransaction`): a registry write that commits or rolls back with the file.
     */
    inLastTransaction?: () => Promise<void>;
    /**
     * `apply` builds the whole table again from the definition (the writer's `buildsWholeTable`),
     * so a table the database lacks is not drift.
     */
    buildsWholeTable?: boolean;
  } = {}
): Promise<CollectionSaveResult | undefined> {
  if (deps === undefined) {
    await apply();
    return undefined;
  }
  if (deps.applies && options.runsFile === true) {
    return writeCollectionSave(deps, save, {
      historyChecked: true,
      ...(options.inLastTransaction === undefined
        ? {}
        : { inLastTransaction: options.inLastTransaction }),
    });
  }
  // Only a part-way failure is the writer's to know; anything else `apply`
  // answers is the caller's.
  const run = async () =>
    (await apply()) === "partly-applied" ? "partly-applied" : undefined;
  return writeCollectionSave(deps, save, {
    historyChecked: true,
    // In development the writer runs it and records the files applied;
    // elsewhere it runs once they are written. Either way a failure that
    // changed nothing withdraws them.
    ...(deps.applies ? { appliedBy: run } : { appliedAfter: run }),
    ...(options.buildsWholeTable === true ? { buildsWholeTable: true } : {}),
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
  /**
   * Removes the entity. Where it runs in one transaction (`rollsBackWhole`),
   * it calls `committed` once that transaction has committed, before any work
   * that follows it.
   */
  apply: (committed: () => void) => Promise<unknown>,
  options: {
    /**
     * Whether `apply` runs in one transaction that a failure undoes whole, as
     * a Single's or a field group's delete does on PostgreSQL and SQLite: a
     * failure before its commit changed nothing, so the files are withdrawn
     * as a refused save's are, rather than kept for a delete that never ran.
     * A failure after its commit (`committed`) comes after a delete the
     * database holds: the files are recorded applied, and the failure thrown.
     */
    rollsBackWhole?: boolean;
  } = {}
): Promise<void> {
  if (deps === undefined) {
    await apply(() => undefined);
    return;
  }
  // Otherwise a delete tears down in steps that cannot be rolled back (MySQL
  // commits each drop, and what ran before it), so a failure may come after
  // some of them ran: its files are kept, recorded applied nowhere, and the
  // failure is still thrown. The next `nextly migrate` finishes the delete
  // from them, as a retried delete would.
  const failed: { error?: unknown } = {};
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
    async () => {
      if (options.rollsBackWhole === true) {
        let committed = false;
        try {
          await apply(() => {
            committed = true;
          });
        } catch (error) {
          // Before the commit it undid everything, so it is thrown through and
          // the writer withdraws the files.
          if (!committed) throw error;
          // After it, the delete stands: its files are recorded applied as
          // any applied save's, and the failure is thrown once they are.
          failed.error = error;
        }
        return undefined;
      }
      try {
        await apply(() => undefined);
        return undefined;
      } catch (error) {
        failed.error = error;
        return "partly-applied";
      }
    }
  );
  if ("error" in failed) throw failed.error;
}
