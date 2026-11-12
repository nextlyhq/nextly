/**
 * Whether the site's Proxy runs: redirects, the not-found log, the staging
 * guard, plain-text copies and the IndexNow key are all answered from it, so
 * a site whose `proxy.ts` is not wired saves redirects that are never served.
 *
 * The Proxy says so itself. Each server notes the time in the address record
 * the first time a request passes through its Proxy, and again at most once
 * an hour, in the background, so a page request never waits on it. The admin
 * and the problem list read the note: a Proxy that has never noted anything
 * is not wired, and one silent for {@link PROXY_QUIET_MS} has stopped running.
 *
 * @module redirects/proxy-seen
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { recordSlug, sha256 } from "../address-record/rows";

import type { ProxyStatus } from "./contract";

/** The key of the record's row the Proxy notes its last request on. */
const SEEN_KEY = sha256("meta:proxy-seen");

/** How often one server notes again that its Proxy runs. */
const PROXY_NOTE_EVERY_MS: number = 60 * 60 * 1000;

/**
 * How long the Proxy may go without a note before it counts as not running:
 * long enough that a quiet site, whose Proxy notes only when a request
 * comes, is not reported on a slow week.
 */
export const PROXY_QUIET_MS: number = 7 * 24 * 60 * 60 * 1000;

/** The row the note is kept on, if it is there yet. */
async function seenRow(
  ctx: PluginContext
): Promise<{ id: string; at: string | undefined } | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: { claimKey: { equals: SEEN_KEY } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as Record<string, unknown>[];
  if (row === undefined) return undefined;
  // The time is kept in the row's text column, as the site's standing is.
  return {
    id: String(row.id),
    at: typeof row.path === "string" ? row.path : undefined,
  };
}

/** Record that the Proxy handled a request at `at`. */
export async function recordProxySeen(
  ctx: PluginContext,
  at: Date = new Date()
): Promise<void> {
  const slug = recordSlug(ctx);
  const path = at.toISOString();
  const found = await seenRow(ctx);
  if (found !== undefined) {
    await ctx.services.collections.updateEntry(slug, found.id, {
      path,
      _overwrite: true,
    });
    return;
  }
  try {
    await ctx.services.collections.createEntry(slug, {
      claimKey: SEEN_KEY,
      kind: "meta",
      path,
    });
  } catch (error) {
    // Another server noted it first: its note says the same thing.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
  }
}

/**
 * A note-taker for one server: `note` records the Proxy as seen the first
 * time and then at most every {@link PROXY_NOTE_EVERY_MS}, without waiting.
 * `now` is the clock, replaced by tests.
 */
export function proxySeenNotes(now: () => number = Date.now): {
  note(ctx: PluginContext): void;
} {
  let notedAt: number | undefined;
  return {
    note(ctx) {
      const at = now();
      if (notedAt !== undefined && at - notedAt < PROXY_NOTE_EVERY_MS) return;
      notedAt = at;
      recordProxySeen(ctx, new Date(at)).catch((error: unknown) => {
        // Tried again with the next request: a missed note costs nothing.
        notedAt = undefined;
        ctx.logger.warn("The SEO plugin could not note that the Proxy runs", {
          error,
        });
      });
    },
  };
}

/** Whether the Proxy runs, as its last note says, judged at `now`. */
export async function readProxyStatus(
  ctx: PluginContext,
  now: number = Date.now()
): Promise<ProxyStatus> {
  const found = await seenRow(ctx);
  const at = found?.at;
  const time = at === undefined ? Number.NaN : Date.parse(at);
  if (at === undefined || Number.isNaN(time)) {
    return { state: "not-wired", lastSeen: null };
  }
  return {
    state: now - time > PROXY_QUIET_MS ? "quiet" : "running",
    lastSeen: at,
  };
}
