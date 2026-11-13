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

import {
  parseFieldRewrite,
  type FieldRewriteResult,
} from "../../domains/versions/field-rewrite";
import { NextlyError } from "../../errors/nextly-error";
import { collectingWarnings } from "../../hooks/side-effect-warnings";
import type { HiddenFieldPaths } from "../../shared/lib/filterable-fields";
import type { PaginatedResponse } from "../../types/pagination";
import type {
  BulkDeleteArgs,
  BulkOperationResult,
  CollectionSlug,
  CountArgs,
  CountResult,
  GroupArgs,
  GroupResult,
  TimeseriesArgs,
  TimeseriesResult,
  CreateArgs,
  RowFromCollectionSlug,
  DeleteArgs,
  DeleteResult,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  ListResult,
  MutationResult,
  PublishArgs,
  PublishResult,
  RewriteFieldArgs,
  UpdateArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  accessOptions,
  buildMutationMessage,
  callerAccess,
  createErrorFromResult,
  isNotFoundError,
  mergeConfig,
} from "./helpers";
import { hiddenFieldRead } from "./hidden-fields";

/**
 * Find multiple documents in a collection.
 *
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
): Promise<ListResult<RowFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);
  // One per call: the refusal and every row returned read each source's
  // declarations once.
  const hiding = hiddenFieldRead(config);
  const source = { kind: "collection", slug: args.collection } as const;

  const result = await ctx.collectionsHandler.listEntries({
    collectionName: args.collection,
    page: args.page,
    offset: args.offset,
    unknownSort: args.unknownSort,
    // A filter or a sort on a field this read leaves out is refused past the
    // read gate, since the rows it keeps would reveal the value. Handed as a
    // lookup the read resolves past its gate, so a refused caller costs no
    // declaration read.
    hiddenFields: () => hiding.pathsOf(source),
    limit: args.limit,
    where: args.where,
    // From `args`, never from `config`: an exemption that `mergeConfig` could
    // supply would reach nested reads the caller's own `where` travels into.
    frameworkFilter: args.frameworkFilter,
    // Lifecycle-aware publish scope (also constrains localized companion _status).
    status: args.status,
    depth: config.depth,
    select: args.select,
    sort: args.sort,
    richTextFormat: config.richTextFormat,
    richTextStyles: config.richTextStyles,
    ...accessOptions(config),
    // i18n M4: forward the content locale + fallback so localized fields resolve.
    locale: config.locale,
    fallbackLocale: config.fallbackLocale,
    sourceLocales: args.sourceLocales,
    translations: args.translations,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  // Adapt the service's PaginatedResponse (`{ docs, totalDocs, ... }`) to
  // the canonical ListResult envelope (`{ items, meta }`). Default missing
  // pagination fields so this still produces a valid meta block when the
  // service returns a slim payload (some test fixtures omit them).
  const legacy = result.data as PaginatedResponse<RowFromCollectionSlug<TSlug>>;
  const total = legacy.totalDocs ?? legacy.docs.length;
  const limit = legacy.limit ?? args.limit ?? legacy.docs.length;
  const page = legacy.page ?? args.page ?? 1;
  const totalPages =
    legacy.totalPages ?? Math.max(1, Math.ceil(total / Math.max(limit, 1)));

  return {
    items: await Promise.all(
      legacy.docs.map(doc => hiding.without(doc, source))
    ),
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
): Promise<RowFromCollectionSlug<TSlug> | null> {
  const config = mergeConfig(ctx.defaultConfig, args);
  try {
    const result = await ctx.collectionsHandler.getEntry({
      collectionName: args.collection,
      entryId: args.id,
      depth: config.depth,
      select: args.select,
      richTextFormat: config.richTextFormat,
      richTextStyles: config.richTextStyles,
      ...accessOptions(config),
      // Overlay the pending working draft when the caller opts in; the service
      // still gates it on an update-capability probe.
      includeWorkingDraft: args.draft,
      // The lifecycle scope, forwarded for the reason `find` forwards it: left
      // out, an untrusted by-id read is bounded to public states and a row that
      // was never published answers 404 -- the overlay above never reaches it.
      status: args.status,
      // i18n M4: forward the content locale + fallback so localized fields resolve.
      locale: config.locale,
      fallbackLocale: config.fallbackLocale,
      sourceLocales: args.sourceLocales,
      translations: args.translations,
      wholeDocumentFallback: args.wholeDocumentFallback,
      context: config.context,
    });

    if (!result.success) {
      // A rule that could not run never answered, so `disableErrors` does not
      // read it as a missing document: the call ends with that answer.
      if (config.disableErrors && result.code !== "RULE_COULD_NOT_RUN") {
        return null;
      }
      throw createErrorFromResult(result);
    }

    return await hiddenFieldRead(config).without(
      result.data as RowFromCollectionSlug<TSlug>,
      { kind: "collection", slug: args.collection }
    );
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
 * the wire API's `respondMutation` envelope. The message uses the
 * collection slug capitalized (e.g. `"Posts created."`) so callers can
 * surface a generic toast without hand-writing copy per collection.
 */

export async function create<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: CreateArgs<TSlug>
): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const { result, warnings } = await collectingWarnings(() =>
    ctx.collectionsHandler.createEntry(
      {
        collectionName: args.collection,
        ...accessOptions(config),
        // Forward the content locale so a localized write lands in the
        // requested language's companion row, not the default locale's.
        locale: config.locale,
        context: config.context,
        disableRevalidate: config.disableRevalidate,
      },
      args.data
    )
  );

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return {
    message: buildMutationMessage(args.collection, "created"),
    item: result.data as RowFromCollectionSlug<TSlug>,
    ...(warnings ? { warnings } : {}),
  };
}

/**
 * Update a document by ID or by `where` clause. Returns the updated document
 * (the first match in the bulk-update case).
 *
 * and where-clause paths.
 */
export async function update<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: UpdateArgs<TSlug>
): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  if (!args.id && !args.where) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Either 'id' or 'where' clause is required for update",
      statusCode: 400,
    });
  }

  if (args.id) {
    // Captured before the closure: the `if (args.id)` narrowing above does not
    // reach inside a callback, and the id is what selects this branch.
    const entryId = args.id;
    const { result, warnings } = await collectingWarnings(() =>
      ctx.collectionsHandler.updateEntry(
        {
          collectionName: args.collection,
          entryId,
          ...accessOptions(config),
          // Forward the content locale so a localized update targets the requested
          // language's companion row, not the default locale's.
          locale: config.locale,
          context: config.context,
          disableRevalidate: config.disableRevalidate,
        },
        args.data
      )
    );

    if (!result.success) {
      throw createErrorFromResult(result);
    }

    return {
      message: buildMutationMessage(args.collection, "updated"),
      item: result.data as RowFromCollectionSlug<TSlug>,
      ...(warnings ? { warnings } : {}),
    };
  }

  if (args.where) {
    // Captured before the closure: the id/where branch above narrows `where`,
    // and that narrowing does not reach inside a callback.
    const where = args.where;
    const { result: bulkResult, warnings } = await collectingWarnings(() =>
      ctx.collectionsHandler.bulkUpdateByQuery(
        {
          collectionName: args.collection,
          where,
          data: args.data,
          ...accessOptions(config),
          context: config.context,
          disableRevalidate: config.disableRevalidate,
        },
        { limit: 1 }
      )
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

    // Phase 4.5: BulkOperationResult.successes carries minimal {id} records
    // for delete and full records for update. bulkUpdateByQuery returns
    // updated records, so we read .id off the first one.
    const updated = await findByID<TSlug>(ctx, {
      collection: args.collection,
      id: (bulkResult.successes[0] as { id: string }).id,
      // The read-back is the caller's read, not the system's. Without these it
      // re-enters `mergeConfig` and picks up the instance default of
      // `overrideAccess: true`, handing an update-scoped caller a row it has no
      // read grant for, with every field-level restriction skipped.
      ...callerAccess(config),
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
      ...(warnings ? { warnings } : {}),
    };
  }

  throw new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Either 'id' or 'where' clause is required for update",
    statusCode: 400,
  });
}

/**
 * Publish or unpublish the parts of one entry `args` chooses, or say what doing so would do.
 *
 * @experimental
 */
async function moveParts(
  ctx: NextlyContext,
  args: PublishArgs,
  direction: "publish" | "unpublish"
): Promise<MutationResult<PublishResult>> {
  const config = mergeConfig(ctx.defaultConfig, args);
  const { result, warnings } = await collectingWarnings(() =>
    ctx.collectionsHandler.publishParts(
      {
        collectionName: args.collection,
        entryId: args.id,
        ...accessOptions(config),
        context: config.context,
        disableRevalidate: config.disableRevalidate,
        data: args.data,
      },
      {
        direction,
        locales: args.locales,
        shared: args.shared,
        describe: args.describe,
      }
    )
  );
  if (!result.success) {
    throw createErrorFromResult(result);
  }
  return {
    message:
      result.message ??
      `${direction === "publish" ? "Published" : "Unpublished"}.`,
    item: result.data as PublishResult,
    ...(warnings ? { warnings } : {}),
  };
}

/** Publish the chosen parts of one entry. @experimental */
export function publish(
  ctx: NextlyContext,
  args: PublishArgs
): Promise<MutationResult<PublishResult>> {
  return moveParts(ctx, args, "publish");
}

/** Unpublish the chosen parts of one entry. @experimental */
export function unpublish(
  ctx: NextlyContext,
  args: PublishArgs
): Promise<MutationResult<PublishResult>> {
  return moveParts(ctx, args, "unpublish");
}

/**
 * Delete a document by ID or by `where` clause.
 *
 * matching the wire API's `respondMutation` envelope. The by-where path
 * still returns the legacy `DeleteResult` (`{ deleted, ids }`) because a
 * multi-row delete cannot collapse into a single mutation envelope.
 */
export async function deleteEntry<
  TSlug extends CollectionSlug = CollectionSlug,
>(
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
    // Captured before the closure, as in `update`: the narrowing above does
    // not reach inside a callback.
    const entryId = args.id;
    const { result, warnings } = await collectingWarnings(() =>
      ctx.collectionsHandler.deleteEntry({
        collectionName: args.collection,
        entryId,
        ...accessOptions(config),
        context: config.context,
        disableRevalidate: config.disableRevalidate,
      })
    );

    if (!result.success) {
      throw createErrorFromResult(result);
    }

    return {
      message: buildMutationMessage(args.collection, "deleted"),
      item: { id: entryId },
      ...(warnings ? { warnings } : {}),
    };
  }

  if (args.where) {
    // Captured before the closure: the id/where branch narrows `where`, and
    // that narrowing does not reach inside a callback.
    const where = args.where;
    const { result: bulkResult, warnings } = await collectingWarnings(() =>
      ctx.collectionsHandler.bulkDeleteByQuery(
        {
          collectionName: args.collection,
          where,
          ...accessOptions(config),
          context: config.context,
          disableRevalidate: config.disableRevalidate,
        },
        { limit: 1000 }
      )
    );

    // The by-where path keeps the legacy `DeleteResult` shape because a
    // multi-row delete returns N ids. Callers needing canonical envelopes
    // for batch ops can switch to bulkDelete (which returns
    // `BulkOperationResult` with per-id success/failure detail).
    //
    // Phase 4.5: BulkOperationResult.successes carries `{id}` records for
    // delete; map to a flat string[] for the legacy DeleteResult contract.
    return {
      deleted: true,
      ids: bulkResult.successes.map(s => s.id),
      ...(warnings ? { warnings } : {}),
    };
  }

  throw new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Either 'id' or 'where' clause is required for delete",
    statusCode: 400,
  });
}

/**
 * The fields an aggregate refuses in its filter or its key, where its call
 * passes `showHiddenFields: false`: the count, the buckets or the timeline
 * would reveal the value a read leaves out. A lookup, not the paths: the read
 * resolves it past its gate, as `find`'s, so a caller the gate refuses never
 * reaches the declarations.
 */
function aggregateHiddenFields(
  config: Parameters<typeof hiddenFieldRead>[0],
  collection: string
): HiddenFieldPaths {
  const hiding = hiddenFieldRead(config);
  return () => hiding.pathsOf({ kind: "collection", slug: collection });
}

/**
 * Count documents matching a query.
 *
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
    hiddenFields: aggregateHiddenFields(config, args.collection),
    where: args.where,
    // From `args`, never `config` -- same reason as `find`: an inheritable
    // exemption would reach nested reads a caller's own `where` travels into.
    frameworkFilter: args.frameworkFilter,
    // Lifecycle scope, from `args` exactly as `find` takes it, so a count and
    // the list beside it describe the same rows.
    status: args.status,
    ...accessOptions(config),
    // i18n M4: parity with find() so locale-scoped counts match.
    locale: config.locale,
    fallbackLocale: config.fallbackLocale,
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
 * How many documents carry each distinct value of one field.
 *
 * Reaches the same resolved row set `count` does — one pipeline settles which
 * rows a caller may read, and each operation only decides what to compute over
 * them — so buckets can never describe rows a count of the same arguments
 * would have excluded.
 */
export async function group(
  ctx: NextlyContext,
  args: GroupArgs
): Promise<GroupResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.groupEntries({
    collectionName: args.collection,
    hiddenFields: aggregateHiddenFields(config, args.collection),
    groupBy: args.groupBy,
    where: args.where,
    // From `args`, never `config`, for the reason `count` takes it from
    // `args`: an inheritable exemption would reach nested reads.
    frameworkFilter: args.frameworkFilter,
    status: args.status,
    ...accessOptions(config),
    locale: config.locale,
    fallbackLocale: config.fallbackLocale,
    context: config.context,
    ...(args.bucketLimit === undefined
      ? {}
      : { bucketLimit: args.bucketLimit }),
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return {
    buckets: result.data?.buckets ?? [],
    truncated: result.data?.truncated ?? false,
  };
}

/**
 * A timeseries' arguments as core's own widget executor passes them: the
 * published `TimeseriesArgs`, and the end of the rows its window keeps.
 *
 * 🔴 Not published. Neither this type nor its field is exported from the
 * package: a Direct API caller states a window by its anchor, and only the
 * widget executor, which reads a window ending at its batch's instant and keeps
 * that instant's whole second (`openWindowEnd`), names where its rows end.
 *
 * @internal
 */
export interface InternalTimeseriesArgs extends TimeseriesArgs {
  /**
   * The exclusive end of the rows the window keeps, where that is past the end
   * of its last interval: a row a database stored rounded into the next
   * interval before this end counts in the last interval. Never read past the
   * interval after the last.
   *
   * @internal
   */
  rowsEnd?: Date;
}

/**
 * How many documents fall in each interval of a recent window.
 *
 * Reaches the same resolved row set `count` and `group` do — one pipeline
 * settles which rows a caller may read, and each operation only decides what to
 * compute over them — so a timeline can never describe rows a count of the same
 * arguments would have excluded.
 */
export async function timeseries(
  ctx: NextlyContext,
  args: InternalTimeseriesArgs
): Promise<TimeseriesResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.collectionsHandler.timeseriesEntries({
    collectionName: args.collection,
    hiddenFields: aggregateHiddenFields(config, args.collection),
    dateField: args.dateField,
    interval: args.interval,
    where: args.where,
    // From `args`, never `config`, for the reason `count` takes it from
    // `args`: an inheritable exemption would reach nested reads.
    frameworkFilter: args.frameworkFilter,
    status: args.status,
    ...accessOptions(config),
    locale: config.locale,
    fallbackLocale: config.fallbackLocale,
    context: config.context,
    ...(args.intervals === undefined ? {} : { intervals: args.intervals }),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.rowsEnd === undefined ? {} : { rowsEnd: args.rowsEnd }),
  });

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return {
    points: result.data?.points ?? [],
    interval: args.interval,
  };
}

/**
 * Bulk-delete multiple documents by IDs (partial success).
 */
export async function bulkDelete(
  ctx: NextlyContext,
  args: BulkDeleteArgs
): Promise<BulkOperationResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const { result: bulkResult, warnings } = await collectingWarnings(() =>
    ctx.collectionsHandler.bulkDeleteEntries({
      collectionName: args.collection,
      ids: args.ids,
      ...accessOptions(config),
      context: config.context,
      disableRevalidate: config.disableRevalidate,
    })
  );

  // Project to the public shape so internal post-commit signals (eventRecorded,
  // revalidationIntents) — already consumed by the write path — never reach a
  // Direct API caller.
  return {
    successes: bulkResult.successes,
    failures: bulkResult.failures,
    total: bulkResult.total,
    successCount: bulkResult.successCount,
    failedCount: bulkResult.failedCount,
    ...(warnings ? { warnings } : {}),
  };
}

/**
 * Duplicate a document (optionally applying field overrides).
 *
 * `respondMutation` envelope.
 */
export async function duplicate<TSlug extends CollectionSlug>(
  ctx: NextlyContext,
  args: DuplicateArgs<TSlug>
): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const { result, warnings } = await collectingWarnings(() =>
    ctx.collectionsHandler.duplicateEntry({
      collectionName: args.collection,
      entryId: args.id,
      overrides: args.overrides,
      ...accessOptions(config),
      context: config.context,
      disableRevalidate: config.disableRevalidate,
    })
  );

  if (!result.success) {
    throw createErrorFromResult(result);
  }

  return {
    message: buildMutationMessage(args.collection, "duplicated"),
    item: result.data as RowFromCollectionSlug<TSlug>,
    ...(warnings ? { warnings } : {}),
  };
}

/**
 * @experimental Rewrite one field of an entry on its live copy and on every
 * pending draft that holds it, in one transaction, without publishing: each
 * draft stays a draft and the entry's status is unchanged. Refused with
 * `STALE_VERSION`, changing nothing, unless the entry is still at
 * `expectedVersion`. Runs no save hooks; records one history event with the
 * reason, and the `entry.updated` event for the live change.
 */
export async function rewriteField(
  ctx: NextlyContext,
  args: RewriteFieldArgs
): Promise<MutationResult<FieldRewriteResult>> {
  const config = mergeConfig(ctx.defaultConfig, args);
  // The request is the call's own fields alone: the instance's default
  // language would otherwise reach a shared field, which takes none.
  const request = parseFieldRewrite({
    collection: args.collection,
    id: args.id,
    field: args.field,
    ...(args.locale === undefined ? {} : { locale: args.locale }),
    expectedVersion: args.expectedVersion,
    set: args.set,
    reason: args.reason,
  });
  const access = accessOptions(config);
  const result = await ctx.collectionsHandler.rewriteField({
    request,
    user: access.user,
    // Trusted unless the call says otherwise, as every Direct API call is.
    overrideAccess: access.overrideAccess !== false,
    authenticatedScope: access.authenticatedScope,
  });
  if (!result.success) {
    throw createErrorFromResult(result);
  }
  return {
    message: buildMutationMessage(args.collection, "updated"),
    item: result.data as FieldRewriteResult,
  };
}
