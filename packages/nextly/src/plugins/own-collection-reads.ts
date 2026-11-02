/**
 * Reads of the collections a plugin declared, shaped by no configured hook
 * (`ctx.services.ownCollections`).
 *
 * A plugin's bookkeeping is read to DECIDE something: whether a component is
 * still used, where a backfill stopped. A site hook that narrows every read to
 * one tenant, retargets a read by id or rewrites the document makes that answer
 * wrong while it looks exact. `overrideAccess` does not help: it skips the
 * access check and nothing else.
 *
 * What the read skips: every configured read hook. That is a collection's
 * `beforeOperation`, `beforeRead` and `afterRead` (the `*` globals and every
 * plugin's own, this plugin's included), the stored hooks, the field hooks set
 * in config, and the list-query filter. What it keeps: what a field's type does
 * to make a stored value readable, because none of it is a hook. That means
 * JSON decoding, timestamp casing, the redaction of server-only values
 * (password hashes, the owner column), the rich-text format and `select`. A
 * field type that decrypted its value would keep that too; no core type does
 * today.
 *
 * The grant is structural rather than a flag. Each context is issued one grant
 * covering exactly the collections its plugin declared, and the grant never
 * appears on `ServiceOpts`, so no call can ask for more than the plugin owns. A
 * plugin that depends on the owner declares none of the owner's collections, so
 * it is refused like any other. Related rows belong to their own collection and
 * keep that collection's hooks: the relationship walk never sees the grant.
 *
 * Runs as the system only, and as no person, even inside a person's request:
 * a hook-free result handed to a person could cross the tenant boundary a site
 * draws with its read hooks. The result is for the plugin's own code.
 *
 * @module plugins/own-collection-reads
 */
import { runWithAccessMemo } from "../auth/access/request-memo";
import { runWithCallerScope } from "../auth/caller-scope";
import { runAsPrincipal } from "../auth/principal-scope";
import { withCurrentLanguages } from "../domains/i18n/configured-locales";
import { NextlyError } from "../errors/nextly-error";
import type { CollectionService } from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import {
  issueHookExemptRead,
  readHooksWaived,
} from "../shared/lib/hook-exempt-read";

import { resolveServiceOpts, type ServiceOpts } from "./service-opts";

/**
 * What a read of the plugin's own collection may say about the call.
 *
 * Only data. There is no `as`, `user`, principal or scope, because the read is
 * the plugin acting on its own bookkeeping, and nothing here can widen the
 * grant or name a person.
 */
export type OwnCollectionReadOpts = Pick<
  ServiceOpts,
  "context" | "locale" | "fallbackLocale"
>;

/**
 * @experimental Reads of the collections this plugin declared, shaped by no
 * configured hook. Never return the result to a person: a site's read hooks
 * may be what keeps one tenant's rows from another.
 */
export interface PluginOwnCollectionReads {
  listEntries(
    slug: string,
    options?: Parameters<CollectionService["listEntries"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["listEntries"]>;
  findEntryById(
    slug: string,
    id: string,
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["findEntryById"]>;
  count(
    slug: string,
    options?: Parameters<CollectionService["count"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["count"]>;
  group(
    slug: string,
    options: Parameters<CollectionService["group"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["group"]>;
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

  const read = async <T>(
    slug: string,
    opts: OwnCollectionReadOpts | undefined,
    run: (context: RequestContext) => Promise<T>
  ): Promise<T> => {
    // Ownership is the precondition for the waiver, so it is refused before
    // anything is resolved or read, and asked with the same function the query
    // service asks before skipping a hook.
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
    // passing `as`, `user` or a principal at runtime gets none of them.
    const resolved = await resolveServiceOpts({
      as: "system",
      context: opts?.context,
      locale: opts?.locale,
      fallbackLocale: opts?.fallbackLocale,
    });
    const context: RequestContext = { ...resolved, hookExemptRead: grant };
    // The same pins the ordinary facade puts around a system call. No person
    // from an enclosing request reaches this read, or a related row's hooks
    // inside it. A system call carries no scope of its own, so an API key's
    // scope from an enclosing request stays ambient, as it does on the
    // ordinary facade, and can only narrow what a related row shows, never
    // widen it.
    return runWithAccessMemo(() =>
      withCurrentLanguages(() =>
        runAsPrincipal(null, () =>
          runWithCallerScope(resolved.authenticatedScope, () => run(context))
        )
      )
    );
  };

  return Object.freeze({
    listEntries: (slug, options, opts) =>
      read(slug, opts, context =>
        collections.listEntries(slug, options, context)
      ),
    findEntryById: (slug, id, opts) =>
      read(slug, opts, context => collections.findEntryById(slug, id, context)),
    count: (slug, options, opts) =>
      read(slug, opts, context => collections.count(slug, options, context)),
    group: (slug, options, opts) =>
      read(slug, opts, context => collections.group(slug, options, context)),
  } satisfies PluginOwnCollectionReads);
}
