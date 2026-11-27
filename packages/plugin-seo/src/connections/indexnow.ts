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
 * `/<key>.txt`, while IndexNow is on: by a route `withNextly`'s rewrite
 * reaches, so no Proxy is needed, and by the Proxy where the site has one.
 * The key is made the first time it is checked or a notice is sent, and kept
 * encrypted in the plugin's settings; it is public by design, as the
 * protocol serves it, but never returned through the admin or any API.
 *
 * Before IndexNow is switched on, the admin checks the key file answers at
 * the site's production address (`checkIndexNowKey`): Bing refuses every
 * notice from a site whose key it cannot read. The endpoint's 202 means only
 * "received, key not checked yet", so a 202 is followed by the same check,
 * and a key file that does not answer is reported as a refused key.
 *
 * @module connections/indexnow
 */
import { randomBytes } from "node:crypto";

import {
  NextlyError,
  type PluginContext,
  type PluginProxyHandler,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import {
  ADDRESSES_MOVED,
  type AddressMove,
  type AddressesMoved,
} from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { heldLanguages, servedAt } from "../languages/versions";
import { siteOriginFor } from "../outputs/site-origin";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";
import { isRecord } from "../plain-values";
import { idOf } from "../problems/hooks";
import { fetchAs, type FetchOptions } from "../received/fetch";
import { originsOf } from "../received/route";
import { NOT_NOTED, type ProxySeenNotes } from "../redirects/proxy-seen";
import type { ReadRules } from "../resolver/provider";

import {
  INDEXNOW_KEY_CHECK_PATH,
  type ConnectionAttempt,
  type ConnectionResult,
  type IndexNowKeyCheck,
} from "./contract";
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

/** A stored key, as the key file's address names it. */
const KEY = /^[0-9a-f]{32}$/;

/**
 * Where `withNextly` rewrites the key file to, behind the API handler: the
 * `KEY_FILE_ROUTE_PREFIX` of `nextly/next`, with the key as its last part.
 */
export const INDEXNOW_KEY_ROUTE_PATH = "/indexnow-key/:key";

/**
 * How long the key file is served while IndexNow is off, for a check under
 * way: the check's own read, which the switch waits for, reaches the site
 * within its ten seconds; the rest is room for a slow start.
 */
const KEY_CHECK_WINDOW_MS = 60_000;

/** The user agent the key check reads the site as, which a log can name. */
const KEY_CHECK_AGENT = "Nextly-SEO-key-check/1.0";

/** What IndexNow reads with. */
export interface IndexNowSetup {
  readRules: ReadRules;
  /** The site's configured origin, where its settings name no address. */
  origin?: string;
  /** How the key check reaches the site; the network unless a test says else. */
  fetch?: Pick<FetchOptions, "resolve" | "transport" | "limits">;
}

/** What the endpoint's answer means. */
export function resultOfStatus(status: number): ConnectionResult {
  if (status === 200) return "sent";
  // Received, the key not checked yet: the search engines read it later.
  if (status === 202) return "accepted";
  // 403: the key was not found at the site; 422: it does not match the
  // addresses' host. Either way, the search engines refused the key.
  if (status === 403 || status === 422) return "refused-key";
  if (status === 429) return "rate-limited";
  return "failed";
}

/** The site's key, made and kept the first time one is needed. */
async function keyOf(ctx: Pick<PluginContext, "settings">): Promise<string> {
  const { indexNowKey } = await readConnections(ctx);
  if (indexNowKey !== undefined && KEY_FILE.test(`/${indexNowKey}.txt`)) {
    return indexNowKey;
  }
  const key = randomBytes(16).toString("hex");
  await writeConnections(ctx, { indexNowKey: key });
  // Read back: where another instance made its own key at the same time,
  // the one kept is the one served, so it is the one every notice names.
  return (await readConnections(ctx)).indexNowKey ?? key;
}

/** The key now stored, where it is another than `used`. */
async function replacedKey(
  ctx: PluginContext,
  used: string
): Promise<string | undefined> {
  const { indexNowKey } = await readConnections(ctx);
  return indexNowKey !== undefined && indexNowKey !== used
    ? indexNowKey
    : undefined;
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

/**
 * One notice for each host's addresses, at most `MOST_URLS` at a time, sent
 * with `key`: how the last went. A notice refused because another
 * instance's key replaced this one before the search engines checked it is
 * sent once more with the key the site now serves.
 */
async function tellHosts(
  ctx: PluginContext,
  fetch: OutboundFetch,
  byHost: ReadonlyMap<string, readonly string[]>,
  key: string
): Promise<ConnectionAttempt> {
  let using = key;
  let last = attemptNow("sent", 0);
  for (const [host, urls] of byHost) {
    for (let at = 0; at < urls.length; at += MOST_URLS) {
      const notice: IndexNowNotice = {
        host,
        key: using,
        urlList: urls.slice(at, at + MOST_URLS),
      };
      let result = await sendOne(fetch, notice);
      const stored =
        result === "refused-key" ? await replacedKey(ctx, using) : undefined;
      if (stored !== undefined) {
        using = stored;
        result = await sendOne(fetch, { ...notice, key: using });
      }
      last = attemptNow(result, notice.urlList.length);
      // The key and the addresses stay out of the log.
      if (result !== "sent") {
        ctx.logger.warn("IndexNow did not take the site's notice", {
          result,
          host,
        });
      }
    }
  }
  return last;
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
    // One read of the record per collection, for all its saved pages.
    const byCollection = new Map<string, string[]>();
    for (const { collection, id } of taken.saved) {
      const ids = byCollection.get(collection) ?? [];
      ids.push(id);
      byCollection.set(collection, ids);
    }
    for (const [collection, ids] of byCollection) {
      const held = await heldLanguages(ctx, collection, ids);
      for (const languages of held.values()) {
        for (const [locale, paths] of languages) {
          for (const path of paths) noted.push({ locale, path });
        }
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
    const byHost = await urlsByHost(noted, origin, hosts);
    let last = await tellHosts(ctx, fetch, byHost, await keyOf(ctx));
    // A 202 says only that the notice was received: the search engines read
    // the key later, and refuse every notice where they cannot. So the key
    // file is read now, as they will read it.
    if (last.result === "accepted") {
      const check = await checkIndexNowKey(ctx, setup);
      if (check.result !== "answering") {
        last = { ...last, result: "refused-key" };
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
 * and each saved page of a collection with SEO whose words changed while its addresses
 * did not. A working draft's save is not noted: nothing a visitor sees has
 * changed. Answers the call that stops taking note, sending what was noted.
 */
export function watchForIndexNow(
  ctx: PluginContext,
  setup: IndexNowSetup,
  types: { readonly collections: readonly string[] }
): () => Promise<void> {
  const queue = indexNowQueue(ctx, setup);
  // Heard on every type and kept to the collections with SEO as each save is
  // made, so a type that gets SEO after the plugin started is noted too.
  ctx.hooks.on(
    "afterUpdate",
    "*",
    (context: { collection?: string; data?: unknown }) => {
      const slug = context.collection;
      if (slug === undefined || !types.collections.includes(slug)) return;
      const id = idOf(context);
      // A draft, or a working draft of a published page (which keeps the
      // live page's status), changes nothing a visitor sees.
      const draft =
        isRecord(context.data) &&
        (context.data.status === "draft" ||
          context.data._isWorkingDraft === true);
      if (id !== undefined && !draft) queue.notePage(slug, id);
    }
  );
  // Announced once each save commits, so a save undone is never noted.
  ctx.events.on(ADDRESSES_MOVED, event => {
    const { moves } = (event.payload ?? {}) as Partial<AddressesMoved>;
    if (Array.isArray(moves)) queue.noteMoves(moves);
  });
  return () => queue.close();
}

/** Whether the key file is served now: IndexNow is on, or a check reads it. */
async function keyFileServed(
  ctx: PluginContext,
  setup: IndexNowSetup,
  until: string | undefined
): Promise<boolean> {
  if ((await setup.readRules(ctx, undefined)).indexNow === true) return true;
  const time = until === undefined ? Number.NaN : Date.parse(until);
  return !Number.isNaN(time) && Date.now() < time;
}

/**
 * The key file's answer for `asked`, the key its address names: the key as
 * plain text, while the file is served and `asked` is the stored key as it
 * is spelled; nothing otherwise, which the caller answers as not found.
 */
async function keyFileAnswer(
  ctx: PluginContext,
  setup: IndexNowSetup,
  asked: string,
  method: string
): Promise<Response | undefined> {
  if (method !== "GET" && method !== "HEAD") return undefined;
  if (!KEY.test(asked)) return undefined;
  const { indexNowKey, indexNowKeyCheckUntil } = await readConnections(ctx);
  if (indexNowKey !== asked) return undefined;
  if (!(await keyFileServed(ctx, setup, indexNowKeyCheckUntil))) {
    return undefined;
  }
  return new Response(method === "HEAD" ? null : asked, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Read again on each check: a key switched off stops answering.
      "cache-control": "no-store",
    },
  });
}

/**
 * Read the key file at the site's production address as the search engines
 * will, the key made first where there is none, and keep what was found.
 * While the read runs the file is served even with IndexNow off, so the
 * check can come before the switch. The read is held to the site's own
 * addresses (`fetchAs`), so it reaches nothing else.
 */
async function checkIndexNowKey(
  ctx: PluginContext,
  setup: IndexNowSetup
): Promise<IndexNowKeyCheck> {
  const at = new Date().toISOString();
  const origin = await siteOriginFor(undefined, ctx, setup);
  if (origin === undefined) {
    const check: IndexNowKeyCheck = { at, result: "no-address" };
    await writeConnections(ctx, { indexNowKeyCheck: check });
    return check;
  }
  const key = await keyOf(ctx);
  await writeConnections(ctx, {
    indexNowKeyCheckUntil: new Date(
      Date.now() + KEY_CHECK_WINDOW_MS
    ).toISOString(),
  });
  let answering = false;
  try {
    const fetched = await fetchAs(
      new URL(`/${key}.txt`, origin),
      KEY_CHECK_AGENT,
      {
        ...setup.fetch,
        origins: await originsOf(ctx, {
          readRules: setup.readRules,
          baseUrl: setup.origin,
        }),
      }
    );
    // The file must answer the key itself, as IndexNow reads it: a page the
    // site serves at that address instead is not the key.
    answering =
      fetched.kind === "received" &&
      fetched.status === 200 &&
      fetched.redirects.length === 0 &&
      fetched.html.trim() === key;
  } finally {
    await writeConnections(ctx, { indexNowKeyCheckUntil: null });
  }
  const check: IndexNowKeyCheck = {
    at,
    result: answering ? "answering" : "not-answering",
    origin,
  };
  await writeConnections(ctx, { indexNowKeyCheck: check });
  return check;
}

/** Key checks running in this process; a screen a person opens needs few. */
let checksRunning = 0;
const MOST_CHECKS = 2;

/**
 * The routes of the key file: the file itself, at the site's root through
 * `withNextly`'s rewrite (no Proxy needed), and the Connections tab's check
 * of it, for whoever manages site-wide SEO.
 */
export function indexNowKeyRoutes(setup: IndexNowSetup): PluginRoute[] {
  return [
    {
      method: "GET",
      path: INDEXNOW_KEY_ROUTE_PATH,
      mount: "root",
      public: true,
      handler: async (req, ctx) =>
        (await keyFileAnswer(ctx, setup, ctx.params.key ?? "", req.method)) ??
        new Response("Not found", {
          status: 404,
          headers: { "cache-control": "no-store" },
        }),
    },
    siteWide({
      method: "POST",
      path: INDEXNOW_KEY_CHECK_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (_req, ctx: PluginRouteContext) => {
        if (checksRunning >= MOST_CHECKS) {
          throw NextlyError.rateLimited({
            retryAfterSeconds: 10,
            logContext: { reason: "seo-indexnow-key-check-busy" },
          });
        }
        checksRunning++;
        try {
          return Response.json(await checkIndexNowKey(ctx, setup));
        } finally {
          checksRunning--;
        }
      },
    }),
  ];
}

/**
 * The Proxy handler that serves the site's IndexNow key at `/<key>.txt`, as
 * the key route does, for a site whose Proxy runs. It claims the key file's
 * address, which no page serves, so a Proxy still starting waits for the
 * start rather than answer it not found. Every other request passes.
 */
export function indexNowKeyProxyHandler(
  setup: IndexNowSetup,
  seen: ProxySeenNotes = NOT_NOTED
): PluginProxyHandler {
  return {
    name: "indexnow-key",
    claims: request => KEY_FILE.test(new URL(request.url).pathname),
    async handle(request, ctx) {
      // Noted in the background, so the admin can tell the Proxy runs.
      void seen.note(ctx);
      const asked = KEY_FILE.exec(new URL(request.url).pathname)?.[1];
      if (asked === undefined) return;
      const response = await keyFileAnswer(ctx, setup, asked, request.method);
      return response === undefined ? undefined : { response };
    },
  };
}
