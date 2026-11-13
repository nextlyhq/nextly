/**
 * Bringing the redirects' addresses in the address record up to date with
 * the redirects themselves, after a process running an earlier version of
 * the plugin saved or removed redirects the record never heard of.
 *
 * Each redirect holds its From address in the record, and the Proxy answers
 * only an address the record says a redirect holds (`redirects/held-keys`).
 * An earlier version kept the record in a collection; while it still runs
 * during a deploy, a redirect it saves (a page's slug change makes one) is
 * held there only, so this version's Proxy would never answer it, and a
 * redirect it removes stays held here, by a redirect that is gone.
 *
 * Run by the catch-up when it finds such writes, after every page has let go
 * of what it no longer holds and before any claims anew, as a save would
 * order it: a page claiming a redirect's address later replaces the
 * redirect.
 *
 * @module redirects/reclaim
 */
import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { heldNow } from "../address-record/participant";
import { heldRows } from "../address-record/store";

import { redirectsSlug } from "./collection";
import { heldByRedirect, redirectOf, type StoredRedirect } from "./store";

/** How many redirects one read takes. */
const PAGE = 200;

const sameHolds = (a: readonly HeldAddress[], b: readonly HeldAddress[]) =>
  a.length === b.length &&
  a.every(held =>
    b.some(
      other =>
        other.locale === held.locale &&
        other.path === held.path &&
        other.range === held.range
    )
  );

/** What the record holds for each redirect, by the redirect's id. */
async function recordedByRedirect(
  ctx: PluginContext,
  slug: string
): Promise<Map<string, HeldAddress[]>> {
  const held = new Map<string, HeldAddress[]>();
  for (const row of await heldRows(ctx)) {
    if (row.holder?.collection !== slug || row.address === null) continue;
    held.set(row.holder.id, [...(held.get(row.holder.id) ?? []), row.address]);
  }
  return held;
}

/** Every redirect, as stored. */
async function everyRedirect(
  ctx: PluginContext,
  slug: string
): Promise<StoredRedirect[]> {
  const found: StoredRedirect[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      pagination: { limit: PAGE, page },
      sort: { field: "id", direction: "asc" },
      depth: 0,
    });
    found.push(...(data as unknown[]).map(redirectOf));
    if ((data as unknown[]).length < PAGE) return found;
  }
}

/**
 * Make the record hold, for the redirect `id`, what the redirect holds now:
 * read under the redirect's lock on the transaction that changes the record,
 * so a save or a removal of it running at the same moment lands wholly
 * before or after. Nothing where the record already says so. Answers
 * whether the record changed, or the address it refused, held by a page.
 */
async function reclaimOne(
  ctx: PluginContext,
  slug: string,
  id: string
): Promise<
  boolean | { refused: { address: HeldAddress; heldBy: AddressHolder } }
> {
  return ctx.services.collections.withTransaction(async transaction => {
    let redirect: StoredRedirect | undefined;
    try {
      redirect = redirectOf(
        await ctx.services.ownCollections.findEntryByIdInTransaction(
          transaction,
          slug,
          id,
          { lock: "update" }
        )
      );
    } catch (error) {
      if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
    }
    const holder: AddressHolder = {
      collection: slug,
      id,
      ...(redirect === undefined ? {} : { label: redirect.source }),
    };
    const holds = redirect === undefined ? [] : heldByRedirect(redirect);
    if (sameHolds(await heldNow(ctx, transaction, holder), holds)) {
      return false;
    }
    const { refused } = await ctx.publicAddresses.move(
      [{ holder, holds }],
      transaction
    );
    const [first] = refused;
    return first === undefined ? true : { refused: first };
  });
}

/**
 * Bring every redirect's addresses in the record up to date: a redirect the
 * record does not hold as it is claims its From address, and one the record
 * holds that is gone lets go of it. A From address a page holds stays the
 * page's: the page is served there, as it would be had the redirect been
 * saved after it. Answers how many redirects the record changed for.
 */
export async function reclaimRedirectAddresses(
  ctx: PluginContext
): Promise<number> {
  const slug = redirectsSlug(ctx);
  const recorded = await recordedByRedirect(ctx, slug);
  const stale = new Set<string>();
  for (const redirect of await everyRedirect(ctx, slug)) {
    if (!sameHolds(recorded.get(redirect.id) ?? [], heldByRedirect(redirect))) {
      stale.add(redirect.id);
    }
    recorded.delete(redirect.id);
  }
  // What is left is held by a redirect not listed: gone, unless saved since
  // the listing, which the read under its lock tells.
  for (const id of recorded.keys()) stale.add(id);
  let changed = 0;
  for (const id of stale) {
    const outcome = await reclaimOne(ctx, slug, id);
    if (outcome === true) changed += 1;
    else if (outcome !== false) {
      ctx.logger.warn(
        "A redirect's From address is held by a page, which is served there instead",
        {
          redirect: id,
          address: outcome.refused.address,
          heldBy: outcome.refused.heldBy,
        }
      );
    }
  }
  return changed;
}
