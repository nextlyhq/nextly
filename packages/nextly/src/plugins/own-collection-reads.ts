/**
 * Reads of the collections a plugin declared, shaped by no hook
 * (`ctx.services.ownCollections`).
 *
 * A plugin's bookkeeping is read to DECIDE something — whether a component is
 * still used, where a backfill stopped — and a site hook that narrows every
 * read to one tenant, retargets a read by id or rewrites the document makes
 * that answer wrong while it looks exact. `overrideAccess` does not help: it
 * skips the access check and nothing else.
 *
 * The grant is structural rather than a flag. Each context is issued one grant
 * covering exactly the collections its plugin declared, and the grant never
 * appears on `ServiceOpts`, so no call can ask for more than the plugin owns.
 * Relationship expansion is untouched: a related row belongs to its own
 * collection, whose hooks still run.
 *
 * @module plugins/own-collection-reads
 */
import { runWithCallerScope } from "../auth/caller-scope";
import { NextlyError } from "../errors/nextly-error";
import type { CollectionService } from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import {
  issueHookExemptRead,
  readHooksWaived,
} from "../shared/lib/hook-exempt-read";

import {
  resolveServiceOpts,
  type PluginCollectionService,
  type ServiceOpts,
} from "./service-opts";

/**
 * What a read of the plugin's own collection may say about the call.
 *
 * Only data. There is no `as`, `user` or scope, because the read is the plugin
 * acting on its own bookkeeping, and nothing here can widen the grant.
 */
export type OwnCollectionReadOpts = Pick<
  ServiceOpts,
  "context" | "locale" | "fallbackLocale"
>;

/** @experimental Reads of the collections this plugin declared. */
export interface PluginOwnCollectionReads {
  listEntries(
    slug: string,
    options?: Parameters<PluginCollectionService["listEntries"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<PluginCollectionService["listEntries"]>;
  findEntryById(
    slug: string,
    id: string,
    opts?: OwnCollectionReadOpts
  ): ReturnType<PluginCollectionService["findEntryById"]>;
  count(
    slug: string,
    options?: Parameters<PluginCollectionService["count"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<PluginCollectionService["count"]>;
}

/**
 * Build the reads for one plugin's context.
 *
 * `owned` is the RESOLVED slug of each collection the plugin declared, so a
 * collection a host renamed is reached under the name it is stored as.
 */
export function ownCollectionReads(
  collections: CollectionService,
  owned: readonly string[]
): PluginOwnCollectionReads {
  const grant = issueHookExemptRead(owned);

  // Ownership is the precondition for the waiver, so it is refused before
  // anything is read, and asked with the same function the query service asks
  // before skipping a hook.
  const read = async <T>(
    slug: string,
    opts: OwnCollectionReadOpts | undefined,
    run: (context: RequestContext) => Promise<T>
  ): Promise<T> => {
    if (!readHooksWaived(grant, slug)) {
      throw NextlyError.invalidInput({
        message: `"${slug}" is not a collection this plugin declared, so it cannot be read without its hooks.`,
        logContext: {
          reason: "own-collection-read-not-owned",
          collection: slug,
        },
      });
    }
    // Named field by field, because what is left out is the point: a caller
    // passing `as` or `user` at runtime gets neither.
    const resolved = await resolveServiceOpts({
      as: "system",
      context: opts?.context,
      locale: opts?.locale,
      fallbackLocale: opts?.fallbackLocale,
    });
    const context: RequestContext = { ...resolved, hookExemptRead: grant };
    return runWithCallerScope(resolved.authenticatedScope, () => run(context));
  };

  return {
    listEntries: (slug, options, opts) =>
      read(slug, opts, context =>
        collections.listEntries(slug, options, context)
      ),
    findEntryById: (slug, id, opts) =>
      read(slug, opts, context => collections.findEntryById(slug, id, context)),
    count: (slug, options, opts) =>
      read(slug, opts, context => collections.count(slug, options, context)),
  };
}
