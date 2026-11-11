/**
 * IndexNow: once switched on in the SEO settings, the search engines taking
 * part (Bing, Yandex, Seznam, Naver and others; Google does not) are told the
 * moment a page is published, changed, given a new address or taken down.
 *
 * Telling them never holds up a save. A save only notes which pages moved;
 * the notes are gathered for a few seconds, so a burst of saves makes one
 * notice, and sent after the save has finished, its outcome kept for the
 * Connections tab and the problem list. A refused key, a rate limit or an
 * endpoint that cannot be reached is reported there and changes nothing on
 * any page.
 *
 * The site proves it owns its addresses with a key served at its root, at
 * `/<key>.txt`, answered by the Proxy while IndexNow is on. The key is made
 * the first time a notice is sent and kept encrypted in the plugin's
 * settings; it is public by design, as the protocol serves it, but never
 * returned through the admin or any API.
 *
 * @module connections/indexnow
 */
import { randomBytes } from "node:crypto";

import type { PluginContext, PluginProxyHandler } from "@nextlyhq/plugin-sdk";

import {
  onAddressesMoved,
  type AddressMove,
} from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { heldLanguages, servedAt } from "../languages/versions";
import { siteOriginFor } from "../outputs/site-origin";
import { isRecord } from "../plain-values";
import { idOf } from "../problems/hooks";
import type { ReadRules } from "../resolver/provider";

import type { ConnectionResult } from "./contract";
import {
  sendIndexNow,
  type IndexNowNotice,
  type OutboundFetch,
} from "./indexnow-send";
import { attemptNow, readConnections, writeConnections } from "./store";

/** How long the notes are gathered after the last save before one is sent. */
const INDEXNOW_SETTLE_MS = 5_000;

/** How long a stream of saves may keep a notice waiting, at most. */
const MOST_WAIT_MS = 30_000;

/** The most addresses one notice may name. */
const MOST_URLS = 10_000;

/** A key: 32 characters, as the protocol takes them. */
const KEY_FILE = /^\/([0-9a-f]{32})\.txt$/;

/** What IndexNow reads with. */
export interface IndexNowSetup {
  readRules: ReadRules;
  /** The site's configured origin, where its settings name no address. */
  origin?: string;
}

/** What the endpoint's answer means. */
export function resultOfStatus(status: number): ConnectionResult {
  if (status === 200 || status === 202) return "sent";
  // 403: the key was not found at the site; 422: it does not match the
  // addresses' host. Either way, the search engines refused the key.
  if (status === 403 || status === 422) return "refused-key";
  if (status === 429) return "rate-limited";
  return "failed";
}

/** The site's key, made and kept the first time one is needed. */
async function keyOf(ctx: PluginContext): Promise<string> {
  const { indexNowKey } = await readConnections(ctx);
  if (indexNowKey !== undefined && KEY_FILE.test(`/${indexNowKey}.txt`)) {
    return indexNowKey;
  }
  const key = randomBytes(16).toString("hex");
  await writeConnections(ctx, { indexNowKey: key });
  return key;
}

/** One address in a language, as the record keys it. */
interface Noted {
  locale: string;
  path: string;
}

/** The plugin's outbound fetch, or nothing where it was given none. */
function fetchOf(ctx: PluginContext): OutboundFetch | undefined {
  const { fetch } = ctx;
  return fetch === undefined ? undefined : (url, init) => fetch(url, init);
}

/** The full addresses of `noted`, on the site's own hosts, by host. */
async function urlsByHost(
  noted: readonly Noted[],
  origin: string,
  hosts: ReadonlySet<string>
): Promise<Map<string, string[]>> {
  const byHost = new Map<string, string[]>();
  for (const { locale, path } of noted) {
    const served = await servedAt(path, locale);
    if (served === undefined) continue;
    let url: URL;
    try {
      url = new URL(served, origin);
    } catch {
      continue;
    }
    if (!hosts.has(url.host)) continue;
    const list = byHost.get(url.host) ?? [];
    if (!list.includes(url.href)) list.push(url.href);
    byHost.set(url.host, list);
  }
  return byHost;
}

/** The notes taken since the last notice, and when the next one goes. */
interface IndexNowQueue {
  /** Note pages whose addresses a save recorded. */
  noteMoves(moves: readonly AddressMove[]): void;
  /** Note a page saved without its addresses changing. */
  notePage(collection: string, id: string): void;
  /** Send what is noted now, rather than when it settles. */
  flush(): Promise<void>;
  /** Send what is noted, and take no more notes. */
  close(): Promise<void>;
}

/** Every running plugin's notes, for sending at once rather than waiting. */
const liveQueues = new Set<IndexNowQueue>();

/**
 * Send every running plugin's notes now, rather than once they settle: for
 * a job, or a test, that needs the notice sent before it goes on.
 */
export async function flushIndexNow(): Promise<void> {
  await Promise.all([...liveQueues].map(queue => queue.flush()));
}

/** IndexNow's notes for one running plugin. */
function indexNowQueue(
  ctx: PluginContext,
  setup: IndexNowSetup
): IndexNowQueue {
  const addresses = new Map<string, Noted>();
  const pages = new Map<string, { collection: string; id: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstNoted: number | undefined;
  let sending: Promise<void> = Promise.resolve();

  const later = () => {
    const now = Date.now();
    firstNoted ??= now;
    if (timer !== undefined) clearTimeout(timer);
    const wait = Math.min(
      INDEXNOW_SETTLE_MS,
      Math.max(0, firstNoted + MOST_WAIT_MS - now)
    );
    timer = setTimeout(() => void flush(), wait);
    // A notice waiting never keeps the process alive by itself.
    timer.unref?.();
  };

  const note = (address: Noted) => {
    addresses.set(`${address.locale}|${address.path}`, address);
  };

  /** Every note taken so far, the notes cleared for the next notice. */
  function take(): {
    noted: Noted[];
    saved: { collection: string; id: string }[];
  } {
    const taken = {
      noted: [...addresses.values()],
      saved: [...pages.values()],
    };
    addresses.clear();
    pages.clear();
    return taken;
  }

  /** The noted addresses, with each saved page's read from the record. */
  async function addressesOf(taken: ReturnType<typeof take>): Promise<Noted[]> {
    const noted = [...taken.noted];
    for (const { collection, id } of taken.saved) {
      const held = await heldLanguages(ctx, collection, [id]);
      for (const [locale, paths] of held.get(id) ?? []) {
        for (const path of paths) noted.push({ locale, path });
      }
    }
    return noted;
  }

  /** Send one notice per host, keeping how the last one went. */
  async function send(taken: ReturnType<typeof take>): Promise<void> {
    if (taken.noted.length === 0 && taken.saved.length === 0) return;
    // Switched off: the notes are dropped, and nothing more is read.
    const rules = await setup.readRules(ctx, undefined);
    if (rules.indexNow !== true) return;
    const noted = await addressesOf(taken);
    if (noted.length === 0) return;
    const origin = await siteOriginFor(undefined, ctx, setup);
    const fetch = fetchOf(ctx);
    if (origin === undefined || fetch === undefined) {
      await writeConnections(ctx, { indexNowLast: attemptNow("no-address") });
      return;
    }
    const hosts = new Set(
      [...productionAddressesOf(rules.productionAddresses), origin].map(
        address => new URL(address).host
      )
    );
    const key = await keyOf(ctx);
    let last = attemptNow("sent", 0);
    for (const [host, urls] of await urlsByHost(noted, origin, hosts)) {
      for (let at = 0; at < urls.length; at += MOST_URLS) {
        const notice: IndexNowNotice = {
          host,
          key,
          urlList: urls.slice(at, at + MOST_URLS),
        };
        const result = await sendOne(fetch, notice);
        last = attemptNow(result, notice.urlList.length);
        if (result !== "sent") {
          // The key and the addresses stay out of the log.
          ctx.logger.warn("IndexNow did not take the site's notice", {
            result,
            host,
          });
        }
      }
    }
    await writeConnections(ctx, { indexNowLast: last });
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    firstNoted = undefined;
    // One notice at a time, in the order they were gathered.
    const taken = take();
    sending = sending.then(async () => {
      try {
        await send(taken);
      } catch (error) {
        ctx.logger.error("IndexNow could not be told about changed pages", {
          error,
        });
      }
    });
    await sending;
  }

  let open = true;
  const queue: IndexNowQueue = {
    noteMoves(moves) {
      if (!open) return;
      for (const move of moves) {
        for (const address of [...move.released, ...move.holds]) {
          if (address.range !== true) note(address);
        }
      }
      later();
    },
    notePage(collection, id) {
      if (!open) return;
      pages.set(`${collection}|${id}`, { collection, id });
      later();
    },
    flush,
    async close() {
      open = false;
      liveQueues.delete(queue);
      await flush();
    },
  };
  liveQueues.add(queue);
  return queue;
}

/** One notice sent, as its result: what the endpoint said, or that it failed. */
async function sendOne(
  fetch: OutboundFetch,
  notice: IndexNowNotice
): Promise<ConnectionResult> {
  try {
    return resultOfStatus(await sendIndexNow(fetch, notice));
  } catch {
    return "failed";
  }
}

/**
 * Take note of every change IndexNow tells search engines about: each page
 * whose addresses a save records (published, moved, taken down, deleted),
 * and each saved page of `targets` whose words changed while its addresses
 * did not. A working draft's save is not noted: nothing a visitor sees has
 * changed. Answers the call that stops taking note, sending what was noted.
 */
export function watchForIndexNow(
  ctx: PluginContext,
  setup: IndexNowSetup,
  targets: readonly string[]
): () => Promise<void> {
  const queue = indexNowQueue(ctx, setup);
  for (const slug of targets) {
    ctx.hooks.on("afterUpdate", slug, (context: { data?: unknown }) => {
      const id = idOf(context);
      const draft = isRecord(context.data) && context.data.status === "draft";
      if (id !== undefined && !draft) queue.notePage(slug, id);
    });
  }
  const stop = onAddressesMoved(moves => queue.noteMoves(moves));
  return async () => {
    stop();
    await queue.close();
  };
}

/**
 * The Proxy handler that serves the site's IndexNow key at `/<key>.txt`
 * while IndexNow is on, so the search engines can check it. Every other
 * request, and every request while it is off, passes untouched.
 */
export function indexNowKeyProxyHandler(
  setup: IndexNowSetup
): PluginProxyHandler {
  return {
    name: "indexnow-key",
    async handle(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return;
      const asked = KEY_FILE.exec(new URL(request.url).pathname)?.[1];
      if (asked === undefined) return;
      const rules = await setup.readRules(ctx, undefined);
      if (rules.indexNow !== true) return;
      const { indexNowKey } = await readConnections(ctx);
      if (indexNowKey !== asked) return;
      return {
        response: new Response(request.method === "HEAD" ? null : asked, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      };
    },
  };
}
