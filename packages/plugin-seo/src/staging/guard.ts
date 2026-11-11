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

/** How long a read of the addresses and the standing is reused. */
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

/** The site's production addresses: the environment's, else the settings'. */
async function productionAddresses(
  ctx: PluginContext,
  readRules: ReadRules
): Promise<string[]> {
  const fromEnvironment = productionAddressesOf(undefined);
  if (fromEnvironment.length > 0) return fromEnvironment;
  return productionAddressesOf(
    (await readRules(ctx, undefined)).productionAddresses
  );
}

/** The site's recorded standing, or nothing before it is decided. */
async function readStanding(
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

/** Whether the site has any page of a type with an address yet. */
async function hasPages(ctx: PluginContext): Promise<boolean> {
  for (const type of await ctx.publicAddresses.types()) {
    const page = await ctx.publicAddresses.held({ type, limit: 1 });
    if (page.items.length > 0) return true;
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

/**
 * What a request is judged by: the production addresses, and the site's
 * standing only where none are known, so that with addresses named the guard
 * never waits on, or fails with, the database.
 */
async function decide(
  ctx: PluginContext,
  readRules: ReadRules
): Promise<{ addresses: string[]; standing: StagingStanding | undefined }> {
  const fromEnvironment = productionAddressesOf(undefined);
  if (fromEnvironment.length > 0) {
    return { addresses: fromEnvironment, standing: undefined };
  }
  const addresses = await productionAddresses(ctx, readRules);
  return {
    addresses,
    standing: addresses.length > 0 ? undefined : await readStanding(ctx),
  };
}

/**
 * The Proxy handler sending `X-Robots-Tag: noindex` from every host but the
 * site's production addresses. The addresses and the standing are read at
 * most every half minute, so a request does not wait on the database.
 */
export function stagingGuard(readRules: ReadRules): PluginProxyHandler {
  let read:
    | {
        at: number;
        value: Promise<{
          addresses: string[];
          standing: StagingStanding | undefined;
        }>;
      }
    | undefined;
  return {
    name: "staging-guard",
    async handle(request, ctx) {
      const now = Date.now();
      if (read === undefined || now - read.at > REREAD_MS) {
        read = { at: now, value: decide(ctx, readRules) };
        // A failed read is not kept: the next request reads again.
        read.value.catch(() => {
          read = undefined;
        });
      }
      const { addresses, standing } = await read.value;
      const origin = new URL(request.url).origin;
      return keptOutOfSearch(origin, addresses, standing)
        ? { headers: { "X-Robots-Tag": "noindex" } }
        : undefined;
    },
  };
}
