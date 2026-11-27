/**
 * Direct API `nextly.trash.*`: deleted entries, from server code.
 *
 * The same trash REST answers at `/trash`: a page of the entries the caller
 * may see, newest first; a restore, which answers the unique values another
 * entry has taken since rather than failing; and removing entries for good.
 * Each goes through the same access checks REST makes, so a caller is refused
 * here exactly where REST would refuse them; trusted server code
 * (`overrideAccess`, the default) runs without them.
 *
 * @experimental
 * @module direct-api/namespaces/trash
 */
import { paginationMetaOf } from "../../api/trash/trash-page";
import type { RestoreEntryResult } from "../../domains/trash/restore-entry";
import type { TrashListItem } from "../../domains/trash/trash-records";
import {
  emptyTrashFor,
  listTrashFor,
  restoreFor,
  type TrashCaller,
} from "../../domains/trash/trash-service";
import type {
  DirectAPIConfig,
  ListResult,
  MutationResult,
} from "../types/shared";

import type { NextlyContext } from "./context";
import {
  accessOptions,
  mergeConfig,
  runAsCaller,
  suppliedByCall,
} from "./helpers";

/** What `trash.list` takes. */
export type TrashListArgs = DirectAPIConfig & {
  /** Only this collection's entries. */
  collection?: string;
  /** 1 to 100; 25 when left out. */
  limit?: number;
  /** From 1. */
  page?: number;
};

/** What `trash.restore` takes: the entry by its own id, or its trash record's. */
export type TrashRestoreArgs = DirectAPIConfig & {
  /** The trashed entry's own id. */
  id?: string;
  /** Its collection, needed only where two collections trashed the same id. */
  collection?: string;
  /** The trash record's id, as `trash.list` gives it, in place of `id`. */
  trashId?: string;
  /**
   * New values for fields whose value another entry has taken since, by
   * field name, as a refused restore listed them.
   */
  values?: Record<string, string | number | boolean | null>;
};

/** What `trash.empty` takes. */
export type TrashEmptyArgs = DirectAPIConfig & {
  /** Only this collection's entries; every one the caller may empty where left out. */
  collection?: string;
  /** Only these trash records. */
  ids?: string[];
};

/** @experimental */
export interface TrashNamespace {
  /** A page of the deleted entries the caller may see, newest first. */
  list(args?: TrashListArgs): Promise<ListResult<TrashListItem>>;
  /**
   * Bring a deleted entry back as it was, as a draft where it had been
   * published. Where a unique value it held is taken, nothing is written and
   * the item is `{ restored: false, conflicts }`: call again with `values`.
   */
  restore(args: TrashRestoreArgs): Promise<MutationResult<RestoreEntryResult>>;
  /** Remove deleted entries for good; the item names those removed. */
  empty(
    args?: TrashEmptyArgs
  ): Promise<MutationResult<{ removed: TrashListItem[] }>>;
}

/** The caller as the trash takes it, from the merged config. */
function callerOf(config: DirectAPIConfig): TrashCaller {
  const access = accessOptions(config);
  return {
    // Trusted only when the merged config says so, as a collection call is.
    overrideAccess: access.overrideAccess === true,
    ...(access.user === undefined ? {} : { user: access.user }),
    ...(access.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: access.authenticatedScope }),
  };
}

export function createTrashNamespace(ctx: NextlyContext): TrashNamespace {
  return {
    // Run as the caller each call names, as every collection operation is.
    list: async (args = {}) =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const page = await listTrashFor(
          callerOf(mergeConfig(ctx.defaultConfig, suppliedByCall(callArgs))),
          {
            ...(callArgs.collection === undefined
              ? {}
              : { collection: callArgs.collection }),
            ...(callArgs.limit === undefined ? {} : { limit: callArgs.limit }),
            ...(callArgs.page === undefined ? {} : { page: callArgs.page }),
          }
        );
        return { items: page.items, meta: paginationMetaOf(page) };
      }),
    restore: async args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const item = await restoreFor(
          callerOf(mergeConfig(ctx.defaultConfig, suppliedByCall(callArgs))),
          callArgs.trashId !== undefined
            ? { trashId: callArgs.trashId }
            : {
                itemId: String(callArgs.id ?? ""),
                ...(callArgs.collection === undefined
                  ? {}
                  : { collection: callArgs.collection }),
              },
          callArgs.values
        );
        return {
          message: item.restored
            ? "Restored from the trash."
            : "A value this entry held is taken; give a new one and restore it again.",
          item,
        };
      }),
    empty: async (args = {}) =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const removed = await emptyTrashFor(
          callerOf(mergeConfig(ctx.defaultConfig, suppliedByCall(callArgs))),
          {
            ...(callArgs.collection === undefined
              ? {}
              : { collection: callArgs.collection }),
            ...(callArgs.ids === undefined ? {} : { ids: callArgs.ids }),
          }
        );
        return {
          message:
            removed.length === 1
              ? "1 entry removed for good."
              : `${removed.length} entries removed for good.`,
          item: { removed },
        };
      }),
  };
}
