/**
 * Expires the cached reads of the entry or Single a plugin's write changed.
 *
 * The intent comes from the builders every content write uses, with the
 * collection's or Single's own `revalidate` setting, so an opted-out one is
 * skipped here as it is everywhere else. An entry's intent carries the
 * collection's tag, which every routed read of the collection is tagged with,
 * so a page found by slug expires without the slug being read.
 *
 * @module plugins/database/expire-content-target
 */
import { flushContentChange } from "../../domains/flush-content-change";
import { getNextlyLogger } from "../../observability/logger";
import {
  buildEntryRevalidationIntent,
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../../revalidation/intent-builders";

import type { ContentTarget } from "./content-target";

/** A registry's read of one record by slug; its `revalidate` is what is used. */
type RecordBySlug = (slug: string) => Promise<unknown>;

/** Best-effort, like every flush after a committed write: logs, never throws. */
export async function expireContentTarget(
  target: ContentTarget
): Promise<void> {
  // Loaded here rather than at the top, as `flushContentChange` loads it: the
  // plugin context is built on paths (the CLI, a script) that never register
  // the service container, and importing it would pull every registration in.
  const { container } = await import("../../di/container");
  if (!container.has("cacheRevalidator")) return;
  const logger = {
    error: (message: string, context?: Record<string, unknown>) =>
      getNextlyLogger().error({
        kind: "contributed-write-flush-failed",
        message,
        ...context,
      }),
  };
  try {
    if (target.kind === "collection") {
      const record = await recordOf(
        container.has("collectionRegistryService")
          ? slug =>
              container
                .get<{
                  getCollectionBySlug: RecordBySlug;
                }>("collectionRegistryService")
                .getCollectionBySlug(slug)
          : undefined,
        target.slug
      );
      await flushContentChange(
        buildEntryRevalidationIntent(
          target.slug,
          readRevalidateConfig(record),
          { id: target.id }
        ),
        logger,
        "a plugin wrote to a collection entry"
      );
      return;
    }
    const record = await recordOf(
      container.has("singleRegistryService")
        ? slug =>
            container
              .get<{ getSingleBySlug: RecordBySlug }>("singleRegistryService")
              .getSingleBySlug(slug)
        : undefined,
      target.slug
    );
    await flushContentChange(
      buildSingleRevalidationIntent(target.slug, readRevalidateConfig(record)),
      logger,
      "a plugin wrote to a Single"
    );
  } catch (error) {
    logger.error("Cache revalidation failed after a plugin write", { error });
  }
}

/**
 * The registry record, or undefined when it cannot be read. The entity's
 * derived tags are then flushed without its extra ones: expiring an opted-out
 * collection's reads costs a cache miss, where skipping the flush would leave
 * its pages showing the previous value.
 */
async function recordOf(
  read: RecordBySlug | undefined,
  slug: string
): Promise<unknown> {
  if (read === undefined) return undefined;
  try {
    return (await read(slug)) ?? undefined;
  } catch {
    return undefined;
  }
}
