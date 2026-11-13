/**
 * Whether the site's Proxy runs: redirects, the not-found log, the staging
 * guard, plain-text copies and the IndexNow key are all answered from it, so
 * a site whose `proxy.ts` is not wired saves redirects that are never served.
 *
 * The Proxy says so itself. Each server reads the note the first time a
 * request passes through its Proxy, and again at most once an hour, in the
 * background, so a page request never waits on it. It writes a new time only
 * where the stored one is an hour old or more, so a site writes the note at
 * most once an hour however many servers start. The admin and the problem
 * list read the note: a Proxy that has never noted anything is not wired, and
 * one silent for {@link PROXY_QUIET_MS} has stopped running.
 *
 * @module redirects/proxy-seen
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { noteKey, putNote, readNotes } from "../address-record/store";

import type { ProxyStatus } from "./contract";

/** The key of the note the Proxy notes its last request on. */
const SEEN_KEY = noteKey("proxy-seen");

/** How often one server notes again that its Proxy runs. */
const PROXY_NOTE_EVERY_MS: number = 60 * 60 * 1000;

/**
 * How long the Proxy may go without a note before it counts as not running:
 * long enough that a quiet site, whose Proxy notes only when a request
 * comes, is not reported on a slow week.
 */
export const PROXY_QUIET_MS: number = 7 * 24 * 60 * 60 * 1000;

/** When the Proxy last noted a request, if it ever has. */
async function seenAt(ctx: PluginContext): Promise<string | undefined> {
  return (await readNotes(ctx, [SEEN_KEY])).notes.get(SEEN_KEY) ?? undefined;
}

/**
 * Whether a note stored at `stored` still says the Proxy runs at `at`: made
 * within the hour, and not after `at`, so a clock set back is noted afresh.
 */
function stillCurrent(stored: string | undefined, at: Date): boolean {
  const time = stored === undefined ? Number.NaN : Date.parse(stored);
  if (Number.isNaN(time)) return false;
  const age = at.getTime() - time;
  return age >= 0 && age < PROXY_NOTE_EVERY_MS;
}

/**
 * Record that the Proxy handled a request at `at`, where the stored note is
 * not already current: a note within the hour says the same.
 */
export async function recordProxySeen(
  ctx: PluginContext,
  at: Date = new Date()
): Promise<void> {
  if (stillCurrent(await seenAt(ctx), at)) return;
  // Another server noting it at the same moment notes the same thing.
  await putNote(ctx, SEEN_KEY, at.toISOString());
}

/**
 * A note-taker for one server: `note` records the Proxy as seen the first
 * time and then at most every {@link PROXY_NOTE_EVERY_MS}. The Proxy does not
 * wait for it; the promise it answers settles once the note is made or
 * failed, and never rejects. `now` is the clock, replaced by tests.
 */
export function proxySeenNotes(now: () => number = Date.now): {
  note(ctx: PluginContext): Promise<void>;
} {
  let notedAt: number | undefined;
  return {
    note(ctx) {
      const at = now();
      if (notedAt !== undefined && at - notedAt < PROXY_NOTE_EVERY_MS) {
        return Promise.resolve();
      }
      notedAt = at;
      return recordProxySeen(ctx, new Date(at)).catch((error: unknown) => {
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
  const at = await seenAt(ctx);
  const time = at === undefined ? Number.NaN : Date.parse(at);
  if (at === undefined || Number.isNaN(time)) {
    return { state: "not-wired", lastSeen: null };
  }
  return {
    state: now - time > PROXY_QUIET_MS ? "quiet" : "running",
    lastSeen: at,
  };
}
