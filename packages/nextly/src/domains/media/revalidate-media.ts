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
import { computeEntryRevalidation } from "../../revalidation/compute-tags";
import type { CacheRevalidator } from "../../revalidation/types";
import { MEDIA_TARGET } from "../../services/collections/trust-bound";

/** Minimal logger surface, so this never forces a service to widen its deps. */
interface ErrorLogger {
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Ids collected by the innermost open batch.
 *
 * A bulk operation is a fan-out over the SINGLE-item method — `bulkDelete` runs
 * `Promise.allSettled` over `delete`, which is what preserves per-row access
 * control and hooks. That leaves the invalidation one layer below the only
 * place that knows the operation was bulk at all, so N ids produce N flushes,
 * each re-invalidating the `nextly:media` collection tag every file shares.
 *
 * Threading a collector through the fan-out means giving every single-item
 * method a parameter it otherwise has no use for, on both service layers. An
 * ambient scope lets the bulk boundary stay one wrapper and the per-item path
 * stay unchanged — the same trade `side-effect-warnings` takes for post-commit
 * hook failures.
 *
 * Deliberately ONE set that nesting shadows, not the stack that module keeps.
 * A diagnostic has to reach every active collector because each reports to a
 * different caller; a flush discharges the obligation for good, so an outer
 * scope repeating it would be the duplication this exists to remove.
 */
const openBatch = new AsyncLocalStorage<Set<string>>();

/**
 * Compute the union of every id's tags and hand it to the sink as ONE intent.
 *
 * Every file's tags include the same `nextly:media` collection tag, and the
 * sink loops intents and tags without deduplicating across them — so one intent
 * per file would invoke `revalidateTag("nextly:media")` once per file,
 * synchronously, before returning. A folder holding a few hundred images makes
 * that the slowest part of the delete.
 *
 * Best-effort and never rethrown. The rows are already committed by the time
 * this runs; turning an unreachable cache into a failed upload would tell the
 * caller their file was lost while it sits in storage.
 */
async function flushTagsFor(
  mediaIds: readonly string[],
  logger?: ErrorLogger
): Promise<void> {
  if (mediaIds.length === 0) return;

  const revalidator = container.has("cacheRevalidator")
    ? container.get<CacheRevalidator>("cacheRevalidator")
    : undefined;
  // Resolved before the tags are computed, not after: with no adapter present —
  // the CLI, a migration, a non-Next runtime — a bulk delete would otherwise
  // build a tag set per file only to discard the union.
  if (!revalidator) return;

  const tags = new Set<string>();
  for (const id of mediaIds) {
    for (const tag of computeEntryRevalidation({
      collection: MEDIA_TARGET,
      id,
    }).tags) {
      tags.add(tag);
    }
  }

  try {
    await revalidator.flush([{ tags: [...tags] }]);
  } catch (error) {
    logger?.error?.("Cache revalidation failed after a media write", { error });
  }
}

/**
 * Collect the invalidations a fan-out produces and flush them once at its end.
 *
 * Wraps a bulk operation whose per-item work already calls
 * {@link revalidateMedia}. Every id those calls contribute is held until `run`
 * settles, then flushed as a single intent.
 *
 * The bust is therefore deferred to the end of the bulk operation rather than
 * following each row's own commit. That window is bounded by the one call the
 * caller is already awaiting, and it closes before the operation returns — the
 * same guarantee a single write gives, taken at the granularity of the
 * operation the caller actually made. A single write opens no scope and keeps
 * flushing immediately after its own commit, ahead of the physical cleanup.
 *
 * Flushed from `finally`, so a fan-out that throws part-way still busts the
 * rows that did commit: the alternative leaves a deleted file being served
 * from cache because a LATER file in the same batch failed.
 */
export async function withMediaRevalidationBatch<T>(
  run: () => Promise<T>,
  logger?: ErrorLogger
): Promise<T> {
  const collected = new Set<string>();
  try {
    return await openBatch.run(collected, run);
  } finally {
    await flushTagsFor([...collected], logger);
  }
}

/**
 * Bust the cache tags for media files that just changed.
 *
 * Inside a {@link withMediaRevalidationBatch} scope this records the ids and
 * returns; the scope flushes them. Outside one it flushes immediately.
 *
 * The revalidator is resolved from the container at CALL time rather than
 * captured: a Next cache adapter registers at request time, well after any of
 * these services are constructed, so anything captured earlier would be the
 * no-op default forever. Reading the container there also means a service built
 * outside DI — which is exactly what the published actions do — still finds the
 * adapter the app registered at boot.
 */
export async function revalidateMedia(
  mediaIds: readonly string[],
  logger?: ErrorLogger
): Promise<void> {
  if (mediaIds.length === 0) return;

  const batch = openBatch.getStore();
  if (batch) {
    for (const id of mediaIds) batch.add(id);
    return;
  }

  await flushTagsFor(mediaIds, logger);
}
