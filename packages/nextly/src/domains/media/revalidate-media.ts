/**
 * Cache invalidation for media, beneath every surface that writes a media row.
 *
 * There are two write surfaces and they do not share a service instance. The
 * unified `MediaService` is built by DI and wraps the legacy one; the published
 * `nextly/actions` subpath constructs its OWN `ServiceContainer` and reaches the
 * legacy service directly, with no DI at all. Invalidation placed on the wrapper
 * covers the first and silently misses the second — an action-driven upload
 * would leave every cached page holding that file stale.
 *
 * So it lives here, called from the layer both surfaces funnel through: the
 * three media-row writes in the legacy service, plus the two in the folder
 * service that write media rows directly (the cascading delete, and moving a
 * file between folders).
 *
 * The same reasoning already shaped the webhook fast-drain, which the legacy
 * service takes for exactly this reason — "callers that reach it WITHOUT the
 * unified media service still get the immediate drain".
 *
 * @module domains/media/revalidate-media
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { container } from "../../di/container";
import {
  computeEntryRevalidation,
  entryIdTag,
} from "../../revalidation/compute-tags";
import type { CacheRevalidator } from "../../revalidation/types";
import { MEDIA_TARGET } from "../../services/collections/trust-bound";

/** Minimal logger surface, so this never forces a service to widen its deps. */
interface ErrorLogger {
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * The tags a fan-out may defer, and whether it is still accepting them.
 *
 * A bulk operation is a fan-out over the SINGLE-item method — `bulkDelete` runs
 * `Promise.allSettled` over `delete`, which is what preserves per-row access
 * control and hooks — so the invalidation sits one layer below the only place
 * that knows the operation was bulk at all.
 *
 * Threading a collector through that fan-out means giving every single-item
 * method a parameter it otherwise has no use for, on both service layers. An
 * ambient scope lets the bulk boundary stay one wrapper and the per-item path
 * stay unchanged — the same trade `side-effect-warnings` takes for post-commit
 * hook failures.
 */
interface DeferredTags {
  /** Tags that are the same for every row, held until the fan-out settles. */
  shared: Set<string>;
  /**
   * Set once the scope has flushed. A handler can outlive the scope that
   * spawned it — `events/event-bus.ts` invokes an async handler fire-and-forget
   * — and `AsyncLocalStorage` propagates this store into it regardless. A write
   * from such a handler after the flush would be added to a set nobody will
   * drain again, so a closed scope defers nothing and the late write flushes
   * whole.
   */
  closed: boolean;
}

const openBatch = new AsyncLocalStorage<DeferredTags>();

/** Resolve the sink, or undefined when no cache adapter is registered. */
function sink(): CacheRevalidator | undefined {
  return container.has("cacheRevalidator")
    ? container.get<CacheRevalidator>("cacheRevalidator")
    : undefined;
}

/** Hand one intent to the sink. Best-effort: a cache failure never rethrows. */
async function flush(
  tags: Set<string>,
  logger: ErrorLogger | undefined,
  revalidator: CacheRevalidator
): Promise<void> {
  if (tags.size === 0) return;
  try {
    await revalidator.flush([{ tags: [...tags] }]);
  } catch (error) {
    logger?.error?.("Cache revalidation failed after a media write", { error });
  }
}

/**
 * Collect the SHARED tags a fan-out produces and flush them once at its end.
 *
 * Only the shared ones are deferred, and the split is the whole design. Two
 * kinds of tag come out of a media write and they have different rules:
 *
 * - a row's own `nextly:media:id:<id>` tag is about THAT write, and must be
 *   busted against its own commit. The row is gone the moment the transaction
 *   commits, so a cached page is already wrong; the delete path then runs a
 *   storage cleanup wrapped in `withRetry(maxAttempts: 3, baseDelayMs: 500)`,
 *   twice. Holding the bust until a fan-out of those settles leaves a deleted
 *   file rendering from cache for the length of the slowest one — and a storage
 *   call that hangs until the request is killed would leave it stale
 *   permanently, despite a committed delete.
 * - `nextly:media` is the same string for every row in the batch, so N files
 *   would invoke `revalidateTag("nextly:media")` N times, synchronously. It
 *   covers reads that list media rather than reads of one file, and busting it
 *   ONCE after every write in the batch has landed is what those reads
 *   actually need — busting it early would leave a list cached between that
 *   bust and a later row's commit.
 *
 * So the id tags stay prompt and the shared tag is paid for once. If the flush
 * below never runs — a hang, a killed request — every row's own tag has already
 * been busted, and only the list tag is missed.
 *
 * Flushed from `finally`, so a fan-out that throws part-way still pays the
 * shared tag for the rows that did commit.
 */
export async function withMediaRevalidationBatch<T>(
  run: () => Promise<T>,
  logger?: ErrorLogger
): Promise<T> {
  const deferred: DeferredTags = { shared: new Set(), closed: false };
  try {
    return await openBatch.run(deferred, run);
  } finally {
    deferred.closed = true;
    const revalidator = sink();
    if (revalidator) await flush(deferred.shared, logger, revalidator);
  }
}

/**
 * Bust the cache tags for media files that just changed.
 *
 * The revalidator is resolved from the container at CALL time rather than
 * captured: a Next cache adapter registers at request time, well after any of
 * these services are constructed, so anything captured earlier would be the
 * no-op default forever. Reading the container here also means a service built
 * outside DI — which is exactly what the published actions do — still finds the
 * adapter the app registered at boot.
 */
export async function revalidateMedia(
  mediaIds: readonly string[],
  logger?: ErrorLogger
): Promise<void> {
  if (mediaIds.length === 0) return;

  // Resolved before the tags are computed: with no adapter present — the CLI, a
  // migration, a non-Next runtime — a bulk delete would otherwise build a tag
  // set per file only to discard the union.
  const revalidator = sink();
  if (!revalidator) return;

  const own = new Set<string>();
  const shared = new Set<string>();
  for (const id of mediaIds) {
    const idTag = entryIdTag(MEDIA_TARGET, id);
    for (const tag of computeEntryRevalidation({
      collection: MEDIA_TARGET,
      id,
    }).tags) {
      // Partitioned by whether the tag names THIS row. Anything that does not
      // is shared with every other row in the collection, so a fan-out repeats
      // it once per file.
      if (tag === idTag) own.add(tag);
      else shared.add(tag);
    }
  }

  const deferred = openBatch.getStore();
  if (deferred && !deferred.closed) {
    for (const tag of shared) deferred.shared.add(tag);
    // The row's own tags still go now, against this write's own commit.
    await flush(own, logger, revalidator);
    return;
  }

  await flush(new Set([...own, ...shared]), logger, revalidator);
}
