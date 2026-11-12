/**
 * Keeping every copy of the site but the real one out of search: a preview,
 * a staging copy or a production build served from another host sends
 * `X-Robots-Tag: noindex` with every response, prerendered pages included,
 * from the site's Proxy.
 *
 * The site's production addresses come from `NEXTLY_PRODUCTION_ADDRESSES`
 * (comma-separated origins), which wins, or else from the SEO settings. With
 * none known, the site's standing decides: a new site with no pages yet is
 * kept out of search until it has an address, while a site that already had
 * pages when this started stays listable, because dropping a live site out
 * of search is the worse error, and its missing address is a problem to fix.
 *
 * The guard runs on every request the Proxy matches, so it reads only the
 * environment for each: the settings and the standing are read once and
 * kept, as `stagingGuard` says.
 *
 * @module staging/guard
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type PluginContext,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import { recordSlug } from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { keptValue } from "../kept-value";
import type { ReadRules } from "../resolver/provider";

/**
 * How a site with no production address known is served: `listable` for a
 * site that had pages when the guard first started, `guarded` for one that
 * had none.
 */
export type StagingStanding = "listable" | "guarded";

/** The key of the record's row that stores the site's standing. */
const STANDING_KEY = createHash("sha256")
  .update("meta:staging-standing", "utf8")
  .digest("hex");

/**
 * How old the addresses and the standing read from the database may grow
 * before they are read again, in the background.
 */
const REREAD_MS = 30_000;

/**
 * Whether a request to `origin` is kept out of search: any origin but the
 * production addresses where some are known, and every origin of a site
 * standing `guarded` where none are.
 */
export function keptOutOfSearch(
  origin: string,
  addresses: readonly string[],
  standing: StagingStanding | undefined
): boolean {
  if (addresses.length > 0) return !addresses.includes(origin);
  return standing === "guarded";
}

/** The site's recorded standing, or nothing before it is decided. */
export async function readStanding(
  ctx: PluginContext
): Promise<StagingStanding | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: { claimKey: { equals: STANDING_KEY } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as Record<string, unknown>[];
  const value = row?.path;
  return value === "listable" || value === "guarded" ? value : undefined;
}

/**
 * Whether any page holds an address on the site yet. A stored document is
 * not enough: one of a type with no page of its own, or a draft, holds no
 * address, so each type is walked until a document that holds one is found.
 */
async function hasPages(ctx: PluginContext): Promise<boolean> {
  for (const type of await ctx.publicAddresses.types()) {
    let after: string | undefined;
    do {
      const page = await ctx.publicAddresses.held({ type, after, limit: 100 });
      if (page.items.some(item => item.holds.length > 0)) return true;
      after = page.next;
    } while (after !== undefined);
  }
  return false;
}

/**
 * Decide the site's standing once, the first time this starts, and record
 * it: `listable` where the site already has pages, `guarded` where it has
 * none. A standing already recorded is kept.
 */
export async function decideStanding(
  ctx: PluginContext
): Promise<StagingStanding> {
  const recorded = await readStanding(ctx);
  if (recorded !== undefined) return recorded;
  const standing: StagingStanding = (await hasPages(ctx))
    ? "listable"
    : "guarded";
  try {
    await ctx.services.collections.createEntry(recordSlug(ctx), {
      claimKey: STANDING_KEY,
      kind: "meta",
      path: standing,
    });
  } catch (error) {
    // Another process starting at the same moment recorded it first: its
    // decision stands.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    return (await readStanding(ctx)) ?? standing;
  }
  return standing;
}

/** What a request is judged by where the environment names no address. */
interface Judged {
  addresses: string[];
  standing: StagingStanding | undefined;
}

/**
 * The settings' production addresses, and the site's standing only where
 * they name none.
 */
async function fromDatabase(
  ctx: PluginContext,
  readRules: ReadRules
): Promise<Judged> {
  const addresses = productionAddressesOf(
    (await readRules(ctx, undefined)).productionAddresses
  );
  return {
    addresses,
    standing: addresses.length > 0 ? undefined : await readStanding(ctx),
  };
}

/**
 * The Proxy handler sending `X-Robots-Tag: noindex` from every host but the
 * site's production addresses.
 *
 * With `NEXTLY_PRODUCTION_ADDRESSES` set, a request is judged by the
 * environment alone and the database is never read. Without it, the
 * settings' addresses and the standing are read once, by the first request,
 * and kept: read again in the background every half minute, so no later
 * request waits on the database.
 */
export function stagingGuard(readRules: ReadRules): PluginProxyHandler {
  let latest: PluginContext | undefined;
  const judged = keptValue(
    () =>
      latest === undefined
        ? Promise.resolve<Judged>({ addresses: [], standing: undefined })
        : fromDatabase(latest, readRules),
    REREAD_MS
  );
  return {
    name: "staging-guard",
    async handle(request, ctx) {
      const origin = new URL(request.url).origin;
      const fromEnvironment = productionAddressesOf(undefined);
      if (fromEnvironment.length > 0) {
        return keptOutOfSearch(origin, fromEnvironment, undefined)
          ? { headers: { "X-Robots-Tag": "noindex" } }
          : undefined;
      }
      latest = ctx;
      const { addresses, standing } = await judged.get();
      // Where the answer hangs on a standing the start has not recorded yet,
      // it is not kept: the next request reads again, so a new site is
      // guarded from the moment its standing is. Only until it is decided,
      // in the first moments after a start.
      if (addresses.length === 0 && standing === undefined) judged.forget();
      return keptOutOfSearch(origin, addresses, standing)
        ? { headers: { "X-Robots-Tag": "noindex" } }
        : undefined;
    },
  };
}
