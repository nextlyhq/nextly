/**
 * What plugins hold for a collection being deleted: what they say the delete
 * takes with it, for the delete dialog, and their removal of it, inside the
 * delete's own transaction.
 *
 * A plugin can keep rows that name a collection by slug (a template drawing
 * its entries, say) in a table of its own. Deleting the collection would
 * leave those rows pointing at a collection that no longer exists. A plugin
 * registers `ctx.hooks.onCollectionDelete` to say what those rows are and to
 * remove them; this module asks and runs those handlers for the delete.
 *
 * Loaded only by a delete and its preview, so nothing else pays for it.
 *
 * @module domains/collections/services/collection-delete-plugins
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type {
  CollectionDeleteImpactItem,
  HookOwner,
} from "../../../hooks/types";

/** What one plugin says deleting the collections takes with it. */
export interface CollectionDeleteImpactGroup {
  /** The plugin's name, as the dialog shows the group under it. */
  readonly plugin: string;
  readonly items: readonly CollectionDeleteImpactItem[];
}

/** The registry's view this module reads. */
type CollectionDeleteSource = Pick<HookRegistry, "collectionDeleteEntries">;

/**
 * What a plugin's `impact` may answer. Parsed here, at the boundary, because
 * the answer is the plugin's and goes on to an admin screen.
 */
const IMPACT_ITEMS = z.array(
  z.object({
    label: z.string().trim().min(1).max(500),
    kind: z.string().trim().min(1).max(100),
  })
);

/** The name an owner is shown under: a plugin's own, or the owner itself. */
function shownAs(owner: HookOwner): string {
  return owner.startsWith("plugin:") ? owner.slice("plugin:".length) : owner;
}

/**
 * What deleting `slugs` together takes with it, one group per plugin, in the
 * order each plugin first registered, its items in the order its handlers
 * registered and named them: a plugin that registered more than once is
 * listed once. A plugin that names nothing is left out. Reads only: each
 * `impact` is asked of every slug, and the delete is not started.
 *
 * @throws NextlyError `INTERNAL_ERROR` naming the plugin when its `impact`
 *   throws or answers something other than a list of `{ label, kind }`
 */
export async function collectionDeleteImpact(
  registry: CollectionDeleteSource,
  slugs: readonly string[]
): Promise<CollectionDeleteImpactGroup[]> {
  // Keyed by owner, not by the name shown: the app and a plugin called
  // "app" are two owners.
  const byOwner = new Map<HookOwner, CollectionDeleteImpactItem[]>();
  for (const { handler, owner } of registry.collectionDeleteEntries()) {
    if (handler.impact === undefined) continue;
    const items = byOwner.get(owner) ?? [];
    byOwner.set(owner, items);
    for (const slug of slugs) {
      let answer: unknown;
      try {
        answer = await handler.impact(slug);
      } catch (error) {
        throw impactFailure(owner, slug, error);
      }
      const parsed = IMPACT_ITEMS.safeParse(answer);
      if (!parsed.success) {
        throw impactFailure(owner, slug, parsed.error);
      }
      items.push(...parsed.data);
    }
  }
  return [...byOwner]
    .filter(([, items]) => items.length > 0)
    .map(([owner, items]) => ({ plugin: shownAs(owner), items }));
}

/** A plugin's `impact` that failed, named by its owner in the log. */
function impactFailure(
  owner: HookOwner,
  slug: string,
  cause: unknown
): NextlyError {
  return NextlyError.internal({
    logContext: {
      reason: "collection-delete-impact-failed",
      owner,
      collection: slug,
    },
    cause: cause instanceof Error ? cause : undefined,
  });
}

/**
 * Run every plugin's `inTransaction` for each of `slugs`, in the delete's
 * transaction `tx`, in registration order and for each slug in the order the
 * delete removes them. What a handler throws propagates, as it was thrown, so
 * the delete rolls back with it.
 */
export async function runCollectionDeleteHandlers(
  registry: CollectionDeleteSource,
  slugs: readonly string[],
  tx: TransactionContext
): Promise<void> {
  for (const { handler } of registry.collectionDeleteEntries()) {
    if (handler.inTransaction === undefined) continue;
    for (const slug of slugs) await handler.inTransaction(slug, tx);
  }
}
