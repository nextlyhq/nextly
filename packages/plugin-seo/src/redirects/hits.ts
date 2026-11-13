/**
 * How often each redirect is used: the Proxy counts every request a redirect
 * answers, and when it last did, so the redirects screen can say which old
 * addresses still bring people in and which no one asks for any more.
 *
 * A request never waits on the count. The Proxy notes a hit in this process
 * and goes on; the notes are written in the background, one write per
 * redirect for every hit noted while the one before was being written, so a
 * busy redirect costs one write per batch rather than one per request. A
 * note lost with its process (a server stopped between a hit and its write)
 * leaves the count a little low, never wrong in the other direction.
 *
 * @module redirects/hits
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { redirectsSlug } from "./collection";
import { redirectOf } from "./store";

/** The hits noted on one redirect and not yet written. */
interface Noted {
  hits: number;
  /** The latest of them, as ISO text. */
  last: string;
}

/** Add `noted` to the redirect `id`'s count, under its row's lock. */
async function writeHits(
  ctx: PluginContext,
  id: string,
  noted: Noted
): Promise<void> {
  const slug = redirectsSlug(ctx);
  await ctx.services.collections.withTransaction(async transaction => {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      transaction,
      slug,
      {
        where: { id: { equals: id } },
        pagination: { limit: 1, page: 1 },
        depth: 0,
      },
      { lock: "update" }
    );
    const [entry] = data as unknown[];
    // Removed since the hit: nothing is left to count it on.
    if (entry === undefined) return;
    const row = redirectOf(entry);
    const lastHit =
      row.lastHit !== null && row.lastHit > noted.last
        ? row.lastHit
        : noted.last;
    await ctx.services.collections.updateEntryInTransaction(
      transaction,
      slug,
      id,
      { hits: row.hits + noted.hits, lastHit, _overwrite: true }
    );
  });
}

/** The hit counter one server's Proxy notes on. */
export interface RedirectHits {
  /** Note that the redirect `id` answered a request at `at`; never waits. */
  note(ctx: PluginContext, id: string, at?: Date): void;
  /** Settles once every hit noted so far is written: for tests. */
  written(): Promise<void>;
}

/** How a batch's hits on one redirect are written. */
type HitWriter = (
  ctx: PluginContext,
  id: string,
  noted: Noted
) => Promise<void>;

/**
 * A counter for one server, writing its notes as described above; `write`
 * is replaced by tests.
 */
export function redirectHits(write: HitWriter = writeHits): RedirectHits {
  const pending = new Map<string, Noted>();
  let writing: Promise<void> | undefined;

  const start = (ctx: PluginContext): void => {
    if (writing !== undefined) return;
    writing = (async () => {
      while (pending.size > 0) {
        const batch = [...pending];
        pending.clear();
        for (const [id, noted] of batch) {
          try {
            await write(ctx, id, noted);
          } catch (error) {
            // A count is worth less than the next request: it is let go.
            ctx.logger.warn(
              "The SEO plugin could not count a redirect's hits",
              {
                error,
              }
            );
          }
        }
      }
    })().finally(() => {
      writing = undefined;
      // A hit noted as the last batch finished is written now.
      if (pending.size > 0) start(ctx);
    });
  };

  return {
    note(ctx, id, at = new Date()) {
      const last = at.toISOString();
      const held = pending.get(id);
      pending.set(id, {
        hits: (held?.hits ?? 0) + 1,
        last: held !== undefined && held.last > last ? held.last : last,
      });
      start(ctx);
    },
    async written() {
      while (writing !== undefined) await writing;
    },
  };
}
