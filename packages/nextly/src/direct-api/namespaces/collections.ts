/**
 * Direct API Collections Namespace
 *
 * Top-level collection CRUD, counting, and bulk operations. These methods hang
 * off the `Nextly` class root (e.g. `nextly.find(...)`) rather than off a
 * namespaced sub-object. The `Nextly` class delegates each method to the
 * standalone functions exported here.
 *
 * @packageDocumentation
 */

import type { PaginatedResponse } from "../../types/pagination";
import { NextlyError, NextlyErrorCode, NotFoundError } from "../errors";
import type {
  BulkDeleteArgs,
  BulkOperationResult,
  CollectionSlug,
  CountArgs,
  CountResult,
  CreateArgs,
  DataFromCollectionSlug,
  DeleteArgs,
  DeleteResult,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  UpdateArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import { createErrorFromResult, isNotFoundError, mergeConfig } from "./helpers";

/**
 * Find multiple documents in a collection.
 *
 * @throws {NextlyError} If the operation fails.
 */
export async function find<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: FindArgs<TSlug>
): Promise<PaginatedResponse<DataFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.listEntries({
    collectionName: args.collection,
    page: args.page,
    limit: args.limit,
    where: args.where,
    depth: config.depth,
    select: args.select,
    sort: args.sort,
    richTextFormat: config.richTextFormat,
    overrideAccess: config.overrideAccess,
    user: config.user
      ? { id: config.user.id, role: config.user.role }
      : undefined,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return result.data as PaginatedResponse<DataFromCollectionSlug<TSlug>>;
}

/**
 * Find a single document by ID.
 */
export async function findByID<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: FindByIDArgs<TSlug>
): Promise<DataFromCollectionSlug<TSlug> | null> {
  const config = mergeConfig(ctx.defaultConfig, args);

  try {
    const result = await ctx.collectionsHandler.getEntry({
      collectionName: args.collection,
      entryId: args.id,
      depth: config.depth,
      select: args.select,
      richTextFormat: config.richTextFormat,
      overrideAccess: config.overrideAccess,
      user: config.user
        ? { id: config.user.id, role: config.user.role }
        : undefined,
      context: config.context,
    });

    if (!result.success) {
      if (config.disableErrors) {
        return null;
      }
      throw createErrorFromResult(result);
    }

    return result.data as DataFromCollectionSlug<TSlug>;
  } catch (error) {
    if (config.disableErrors && isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Create a new document in a collection.
 */
export async function create<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: CreateArgs<TSlug>
): Promise<DataFromCollectionSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.createEntry(
    {
      collectionName: args.collection,
      overrideAccess: config.overrideAccess,
      user: config.user
        ? { id: config.user.id, role: config.user.role }
        : undefined,
      context: config.context,
    },
    args.data
  );

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return result.data as DataFromCollectionSlug<TSlug>;
}

/**
 * Update a document by ID or by `where` clause. Returns the updated document
 * (the first match in the bulk-update case).
 */
export async function update<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: UpdateArgs<TSlug>
): Promise<DataFromCollectionSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  if (!args.id && !args.where) {
    throw new NextlyError(
      "Either 'id' or 'where' clause is required for update",
      NextlyErrorCode.INVALID_INPUT,
      400
    );
  }

  if (args.id) {
    const result = await ctx.collectionsHandler.updateEntry(
      {
        collectionName: args.collection,
        entryId: args.id,
        overrideAccess: config.overrideAccess,
        user: config.user
          ? { id: config.user.id, role: config.user.role }
          : undefined,
        context: config.context,
      },
      args.data
    );

    if (!result.success) {
      throw createErrorFromResult(result);
    }

    return result.data as DataFromCollectionSlug<TSlug>;
  }

  if (args.where) {
    const bulkResult = await ctx.collectionsHandler.bulkUpdateByQuery(
      {
        collectionName: args.collection,
        where: args.where,
        data: args.data,
        overrideAccess: config.overrideAccess,
        user: config.user
          ? { id: config.user.id, role: config.user.role }
          : undefined,
        context: config.context,
      },
      { limit: 1 }
    );

    if (bulkResult.successCount === 0) {
      throw new NotFoundError("No documents matched the where clause", {
        collection: args.collection,
        where: args.where,
      });
    }

    const updated = await findByID<TSlug>(ctx, {
      collection: args.collection,
      id: bulkResult.success[0],
    } as FindByIDArgs<TSlug>);

    if (!updated) {
      throw new NextlyError(
        "Document was updated but could not be retrieved",
        NextlyErrorCode.INTERNAL_ERROR,
        500
      );
    }

    return updated;
  }

  throw new NextlyError(
    "Either 'id' or 'where' clause is required for update",
    NextlyErrorCode.INVALID_INPUT,
    400
  );
}

/**
 * Delete a document by ID or by `where` clause.
 */
export async function deleteEntry(
  ctx: NextlyContext,
  args: DeleteArgs
): Promise<DeleteResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  if (!args.id && !args.where) {
    throw new NextlyError(
      "Either 'id' or 'where' clause is required for delete",
      NextlyErrorCode.INVALID_INPUT,
      400
    );
  }

  if (args.id) {
    const result = await ctx.collectionsHandler.deleteEntry({
      collectionName: args.collection,
      entryId: args.id,
      overrideAccess: config.overrideAccess,
      user: config.user
        ? { id: config.user.id, role: config.user.role }
        : undefined,
      context: config.context,
    });

    if (!result.success) {
      throw createErrorFromResult(result);
    }

    return {
      deleted: true,
      ids: [args.id],
    };
  }

  if (args.where) {
    const bulkResult = await ctx.collectionsHandler.bulkDeleteByQuery(
      {
        collectionName: args.collection,
        where: args.where,
        overrideAccess: config.overrideAccess,
        user: config.user
          ? { id: config.user.id, role: config.user.role }
          : undefined,
        context: config.context,
      },
      { limit: 1000 }
    );

    return {
      deleted: true,
      ids: bulkResult.success,
    };
  }

  throw new NextlyError(
    "Either 'id' or 'where' clause is required for delete",
    NextlyErrorCode.INVALID_INPUT,
    400
  );
}

/**
 * Count documents matching a query.
 */
export async function count(
  ctx: NextlyContext,
  args: CountArgs
): Promise<CountResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.countEntries({
    collectionName: args.collection,
    where: args.where,
    overrideAccess: config.overrideAccess,
    user: config.user
      ? { id: config.user.id, role: config.user.role }
      : undefined,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return result.data as CountResult;
}

/**
 * Bulk-delete multiple documents by IDs (partial success).
 */
export async function bulkDelete(
  ctx: NextlyContext,
  args: BulkDeleteArgs
): Promise<BulkOperationResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const bulkResult = await ctx.collectionsHandler.bulkDeleteEntries({
    collectionName: args.collection,
    ids: args.ids,
    overrideAccess: config.overrideAccess,
    user: config.user
      ? { id: config.user.id, role: config.user.role }
      : undefined,
    context: config.context,
  });

  return bulkResult;
}

/**
 * Duplicate a document (optionally applying field overrides).
 */
export async function duplicate<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: DuplicateArgs<TSlug>
): Promise<DataFromCollectionSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.duplicateEntry({
    collectionName: args.collection,
    entryId: args.id,
    overrides: args.overrides,
    overrideAccess: config.overrideAccess,
    user: config.user
      ? { id: config.user.id, role: config.user.role }
      : undefined,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return result.data as DataFromCollectionSlug<TSlug>;
}
