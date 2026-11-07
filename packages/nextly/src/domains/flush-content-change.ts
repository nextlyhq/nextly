/**
 * Expires the cached reads a content change makes stale, through whichever
 * revalidator the app registered.
 *
 * For the writes that change what reads return without going through an entry
 * or Single service: deleting a collection or a Single, or a plugin writing to
 * columns it added to one. And for the changes that write no content at all
 * yet change what every read may return: the site's languages, and what a
 * role grants. Each passes the intent its builder made, which is
 * `undefined` when the collection or Single opts out of revalidation, so an
 * opted-out one is skipped here exactly as on every other write.
 *
 * @module domains/flush-content-change
 */
import {
  buildCollectionRevalidationIntent,
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../revalidation/intent-builders";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../revalidation/types";

import type { LanguageChangeContentCache } from "./i18n/services/language-settings-service";

/** Where a failed flush is reported. */
interface FlushLogger {
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Flushes `intent` to the registered revalidator. Best-effort: the change is
 * already committed, so a failure is logged, never thrown. Nothing to flush,
 * or no revalidator registered (the CLI, a script), is a no-op.
 */
export async function flushContentChange(
  intent: RevalidationIntent | undefined,
  logger: FlushLogger | undefined,
  what: string
): Promise<void> {
  if (!intent || intent.tags.length === 0) return;
  // Loaded here rather than at the top: the metadata services that call this
  // are imported by CLI paths that never reach the service registry, and a
  // static import would make every one of them load it.
  const { container } = await import("../di/container");
  if (!container.has("cacheRevalidator")) return;
  try {
    await container.get<CacheRevalidator>("cacheRevalidator").flush([intent]);
  } catch (error) {
    logger?.error?.(`Cache revalidation failed after ${what}`, { error });
  }
}

/**
 * The intent that expires the cached reads of a collection or Single being
 * deleted, from the `revalidate` value its registry row stores: a JSON string
 * on SQLite and the raw-insert path, an object on PostgreSQL and MySQL.
 * `undefined` when it opts out. Read from the row the delete removes, inside
 * its transaction, so the setting is the current one rather than a cached copy.
 */
export function deletedEntityIntent(
  kind: "collection" | "single",
  slug: string,
  stored: unknown
): RevalidationIntent | undefined {
  const revalidate = readRevalidateConfig({ revalidate: parsed(stored) });
  return kind === "collection"
    ? buildCollectionRevalidationIntent(slug, revalidate)
    : buildSingleRevalidationIntent(slug, revalidate);
}

/** A stored JSON value, parsed; one that does not parse reads as unset. */
function parsed(stored: unknown): unknown {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

/**
 * Flushes the cache tags of every collection and Single, as one intent: the
 * tags their writes flush, the configured `revalidate.tags` included, through
 * the same intent builders, and none for one whose `revalidate.disable` opts it
 * out. Nothing where `cache` names no revalidator, so a process that caches
 * nothing reads no registry. Rejects when the registries or the flush fail;
 * each caller says what it could not refresh.
 */
export async function flushEveryContentScope(
  cache: LanguageChangeContentCache
): Promise<void> {
  const revalidator = cache.revalidator();
  if (!revalidator) return;
  const { collections, singles } = await cache.content();
  const intents = [
    ...collections.map(c =>
      buildCollectionRevalidationIntent(c.slug, readRevalidateConfig(c))
    ),
    ...singles.map(s =>
      buildSingleRevalidationIntent(s.slug, readRevalidateConfig(s))
    ),
  ];
  const tags = new Set(intents.flatMap(intent => intent?.tags ?? []));
  // A site with nothing to flush issues no revalidation, which some backends log as an error.
  if (tags.size === 0) return;
  await revalidator.flush([{ tags: [...tags] }]);
}
