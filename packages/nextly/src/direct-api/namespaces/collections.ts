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

import { NextlyError } from "../../errors/nextly-error";
import type { PaginatedResponse } from "../../types/pagination";
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
  ListResult,
  MutationResult,
  UpdateArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  buildMutationMessage,
  createErrorFromResult,
  isNotFoundError,
  mergeConfig,
} from "./helpers";

/**
 * Find multiple documents in a collection.
 *
 * Phase 4 (Task 13): returns `ListResult<T>` (`{ items, meta }`). The
 * `collectionsHandler.listEntries()` service still produces the legacy
 * Payload-style envelope (`{ docs, totalDocs, limit, page, totalPages,
 * hasNextPage, hasPrevPage, ... }`); we adapt to the canonical shape at
 * this Direct-API boundary so service-layer migration can happen later
 * without churning consumers.
 *
 * @throws {NextlyError} If the operation fails.
 */
export async function find<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: FindArgs<TSlug>
): Promise<ListResult<DataFromCollectionSlug<TSlug>>> {
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

  // Adapt the service's PaginatedResponse (`{ docs, totalDocs, ... }`) to
  // the canonical ListResult envelope (`{ items, meta }`). Default missing
  // pagination fields so this still produces a valid meta block when the
  // service returns a slim payload (some test fixtures omit them).
  const legacy = result.data as PaginatedResponse<DataFromCollectionSlug<TSlug>>;
  const total = legacy.totalDocs ?? legacy.docs.length;
  const limit = legacy.limit ?? args.limit ?? legacy.docs.length;
  const page = legacy.page ?? args.page ?? 1;
  const totalPages = legacy.totalPages ?? Math.max(1, Math.ceil(total / Math.max(limit, 1)));

  return {
    items: legacy.docs,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: legacy.hasNextPage ?? page < totalPages,
      hasPrev: legacy.hasPrevPage ?? page > 1,
    },
  };
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
 *
 * Phase 4 (Task 13): returns `{ message, item }` so the Direct API matches
 * the wire API's `respondMutation` envelope. The message uses the
 * collection slug capitalized (e.g. `"Posts created."`) so callers can
 * surface a generic toast without hand-writing copy per collection.
 */
export async function create<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: CreateArgs<TSlug>
): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
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

  return {
    message: buildMutationMessage(args.collection, "created"),
    item: result.data as DataFromCollectionSlug<TSlug>,
  };
}

/**
 * Update a document by ID or by `where` clause. Returns the updated document
 * (the first match in the bulk-update case).
 *
 * Phase 4 (Task 13): returns `{ message, item }` for both the single-id
 * and where-clause paths.
 */
export async function update<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: UpdateArgs<TSlug>
): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  if (!args.id && !args.where) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Either 'id' or 'where' clause is required for update",
      statusCode: 400,
    });
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

    return {
      message: buildMutationMessage(args.collection, "updated"),
      item: result.data as DataFromCollectionSlug<TSlug>,
    };
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
      throw NextlyError.notFound({
        logContext: {
          collection: args.collection,
          where: args.where,
          reason: "where-clause-no-match",
        },
      });
    }

    const updated = await findByID<TSlug>(ctx, {
      collection: args.collection,
      id: bulkResult.success[0],
    });

    if (!updated) {
      throw new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "Document was updated but could not be retrieved",
        statusCode: 500,
      });
    }

    return {
      message: buildMutationMessage(args.collection, "updated"),
      item: updated,
    };
  }

  throw new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Either 'id' or 'where' clause is required for update",
    statusCode: 400,
  });
}

/**
 * Delete a document by ID or by `where` clause.
 *
 * Phase 4 (Task 13): the by-id path returns `{ message, item: { id } }`
 * matching the wire API's `respondMutation` envelope. The by-where path
 * still returns the legacy `DeleteResult` (`{ deleted, ids }`) because a
 * multi-row delete cannot collapse into a single mutation envelope.
 */
export async function deleteEntry<TSlug extends CollectionSlug = CollectionSlug>(
  ctx: NextlyContext,
  args: DeleteArgs<TSlug>
): Promise<MutationResult<{ id: string }> | DeleteResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  if (!args.id && !args.where) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Either 'id' or 'where' clause is required for delete",
      statusCode: 400,
    });
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
      message: buildMutationMessage(args.collection, "deleted"),
      item: { id: args.id },
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

    // The by-where path keeps the legacy `DeleteResult` shape because a
    // multi-row delete returns N ids. Callers needing canonical envelopes
    // for batch ops can switch to bulkDelete (which returns
    // `BulkOperationResult` with per-id success/failure detail).
    return {
      deleted: true,
      ids: bulkResult.success,
    };
  }

  throw new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Either 'id' or 'where' clause is required for delete",
    statusCode: 400,
  });
}

/**
 * Count documents matching a query.
 *
 * Phase 4 (Task 13): returns `{ total }` instead of `{ totalDocs }`. The
 * `collectionsHandler.countEntries()` service still produces the legacy
 * `{ totalDocs }` shape; we adapt to the canonical key here so the Direct
 * API and the wire API's `respondCount` envelope agree.
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

  // Service still returns the legacy `{ totalDocs }` shape. Adapt to the
  // canonical `{ total }` envelope at this Direct-API boundary.
  const legacy = result.data as { totalDocs?: number; total?: number };
  return { total: legacy.total ?? legacy.totalDocs ?? 0 };
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
 *
 * Phase 4 (Task 13): returns `{ message, item }` matching the wire API's
 * `respondMutation` envelope.
 */
export async function duplicate<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: DuplicateArgs<TSlug>
): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
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

  return {
    message: buildMutationMessage(args.collection, "duplicated"),
    item: result.data as DataFromCollectionSlug<TSlug>,
  };
}
