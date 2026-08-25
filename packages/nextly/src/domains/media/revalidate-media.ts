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

import { container } from "../../di/container";
import { computeEntryRevalidation } from "../../revalidation/compute-tags";
import type { CacheRevalidator } from "../../revalidation/types";
import { MEDIA_TARGET } from "../../services/collections/trust-bound";

/** Minimal logger surface, so this never forces a service to widen its deps. */
interface ErrorLogger {
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Bust the cache tags for media files that just changed.
 *
 * Resolved from the container at CALL time rather than captured: a Next cache
 * adapter registers at request time, well after any of these services are
 * constructed, so anything captured earlier would be the no-op default forever.
 * Reading the container here also means a service built outside DI — which is
 * exactly what the published actions do — still finds the adapter the app
 * registered at boot.
 *
 * Best-effort and never rethrown. The row is already committed by the time this
 * runs; turning an unreachable cache into a failed upload would tell the caller
 * their file was lost while it sits in storage.
 */
export async function revalidateMedia(
  mediaIds: readonly string[],
  logger?: ErrorLogger
): Promise<void> {
  if (mediaIds.length === 0) return;

  const revalidator = container.has("cacheRevalidator")
    ? container.get<CacheRevalidator>("cacheRevalidator")
    : undefined;
  if (!revalidator) return;

  try {
    await revalidator.flush(
      mediaIds.map(id =>
        computeEntryRevalidation({ collection: MEDIA_TARGET, id })
      )
    );
  } catch (error) {
    logger?.error?.("Cache revalidation failed after a media write", { error });
  }
}
