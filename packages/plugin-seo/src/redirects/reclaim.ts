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

/** Which half of a pass {@link reclaimOne} makes. */
type Step = "release" | "claim";

/**
 * Bring the record's holding for the redirect `id` towards what the
 * redirect holds now: at the `release` step, let go of every address it no
 * longer holds (all of them, where it is gone); at the `claim` step, hold
 * what it does. Read under the redirect's lock on the transaction that
 * changes the record, so a save or a removal of it running at the same
 * moment lands wholly before or after. Nothing where the record already
 * says so. Answers whether the record changed, or the address it refused
 * and who holds it.
 */
async function reclaimOne(
  ctx: PluginContext,
  slug: string,
  id: string,
  step: Step
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
    const wanted = redirect === undefined ? [] : heldByRedirect(redirect);
    const now = await heldNow(ctx, transaction, holder);
    const holds =
      step === "claim"
        ? wanted
        : now.filter(held => wanted.some(each => sameHolds([each], [held])));
    if (sameHolds(now, holds)) return false;
    const { refused } = await ctx.publicAddresses.move(
      [{ holder, holds }],
      transaction
    );
    const [first] = refused;
    return first === undefined ? true : { refused: first };
  });
}

/** What {@link reclaimRedirectAddresses} did. */
export interface ReclaimReport {
  /** How many redirects the record changed for. */
  changed: number;
  /**
   * False where a redirect's From address was refused because another
   * redirect still holds it: two redirects never share a From address, so
   * that holding is stale, and the next start is to try again.
   */
  settled: boolean;
}

/**
 * The redirects whose holding in the record is not what they hold now: one
 * the record holds differently, and one it holds that is not listed (gone,
 * unless saved since the listing, which {@link reclaimOne} tells).
 */
async function staleRedirects(
  ctx: PluginContext,
  slug: string
): Promise<Set<string>> {
  const recorded = await recordedByRedirect(ctx, slug);
  const stale = new Set<string>();
  for (const redirect of await everyRedirect(ctx, slug)) {
    if (!sameHolds(recorded.get(redirect.id) ?? [], heldByRedirect(redirect))) {
      stale.add(redirect.id);
    }
    recorded.delete(redirect.id);
  }
  for (const id of recorded.keys()) stale.add(id);
  return stale;
}

/**
 * Bring every redirect's addresses in the record up to date: a redirect the
 * record does not hold as it is claims its From address, and one the record
 * holds that is gone lets go of it. Every address no redirect holds any
 * more is let go of before any is claimed, so a redirect removed and another
 * saved from the same address meanwhile hands it over. A From address a page
 * holds stays the page's: the page is served there, as it would be had the
 * redirect been saved after it.
 */
export async function reclaimRedirectAddresses(
  ctx: PluginContext
): Promise<ReclaimReport> {
  const slug = redirectsSlug(ctx);
  const stale = await staleRedirects(ctx, slug);
  const report: ReclaimReport = { changed: 0, settled: true };
  for (const step of ["release", "claim"] as const) {
    for (const id of stale) {
      const outcome = await reclaimOne(ctx, slug, id, step);
      if (typeof outcome === "boolean") {
        if (outcome) report.changed += 1;
        continue;
      }
      if (outcome.refused.heldBy.collection === slug) report.settled = false;
      ctx.logger.warn(
        "A redirect's From address is held by another page or redirect, which is served there instead",
        { redirect: id, ...outcome.refused }
      );
    }
  }
  return report;
}
