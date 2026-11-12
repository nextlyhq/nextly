/**
 * The routes behind "What search engines received": the pages the screen
 * offers, and the check itself, which fetches one of the site's pages as
 * Googlebot, LinkedIn, X and Slack and compares what each received with what
 * Nextly holds for that page.
 *
 * The address is refused before anything is fetched unless it is one of the
 * site's own pages (`addresses`), and every fetch is held to the same rule
 * hop by hop (`fetch`). What Nextly holds is the page's head as the plugin
 * answers it, read from the published page the address record says holds
 * the address, and only for a caller who may read that page's type. Both
 * routes are for someone holding `check-seo`.
 *
 * @module received/route
 */
import {
  addressOfRequest,
  getCachedNextly,
  NextlyError,
  type AddressHolder,
  type PageMetadataAnswer,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { addressHolders } from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { originOf } from "../origin";
import { listPages } from "../outputs/listing";
import { CHECK_SEO_PERMISSION } from "../permissions";
import { designLevelOf } from "../resolver/design-level";
import type { SeoLevel, Sourced } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import { publishedWhere } from "../sitemap";

import { addressToCheck } from "./addresses";
import { compareReceived, type StoredHead } from "./compare";
import {
  CRAWLERS,
  RECEIVED_PAGES_ROUTE_PATH,
  RECEIVED_ROUTE_PATH,
  type CrawlerKey,
  type ReceivedAnswer,
  type ReceivedPagesBody,
} from "./contract";
import { fetchAs, type FetchOptions, type Fetched } from "./fetch";

/** What the routes read the site and its pages with. */
export interface ReceivedSetup {
  /** The collections the plugin adds SEO to. */
  collections: readonly string[];
  /** The Singles the plugin adds SEO to. */
  singles: readonly string[];
  /** The origin the plugin was configured with, where it was. */
  baseUrl?: string;
  /** Where the page's head reads the site's rules from. */
  readRules: ReadRules;
  /** The page's head, as the plugin answers it to the site's routes. */
  pageMetadata: (ctx: PluginContext) => PageMetadataResolver;
  /** How pages are fetched; the network itself unless a test says else. */
  fetch?: Pick<FetchOptions, "resolve" | "transport" | "limits">;
}

/** The most pages the screen is offered to choose from. */
const MAX_PAGES = 500;

/** The most checks that may run at once, each fetching four times. */
const MAX_RUNNING = 4;
let running = 0;

const CHECK_BODY = z.object({ address: z.string().min(1).max(2048) });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The site's production addresses, the only places a page may be fetched. */
async function originsOf(
  ctx: PluginContext,
  setup: ReceivedSetup
): Promise<string[]> {
  const rules = await setup.readRules(ctx, undefined);
  const configured = originOf(setup.baseUrl);
  return [
    ...new Set([
      ...productionAddressesOf(rules.productionAddresses),
      ...(configured === undefined ? [] : [configured]),
    ]),
  ];
}

/** The signed-in caller, or a refusal for anyone else. */
function signedIn(
  ctx: PluginRouteContext
): NonNullable<PluginRouteContext["caller"]> {
  if (ctx.caller === null) {
    throw NextlyError.authRequired({
      logContext: { reason: "seo-received-not-signed-in" },
    });
  }
  return ctx.caller;
}

/** The request's body, parsed, or a refusal naming what is wrong. */
async function checkBody(req: Request): Promise<z.infer<typeof CHECK_BODY>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "seo-received-body-not-json" },
    });
  }
  const parsed = CHECK_BODY.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: { reason: "seo-received-body-invalid" },
    });
  }
  return parsed.data;
}

/**
 * A page's published document, read as the route's caller, so the
 * collection's row and field rules decide what of it they see: nothing where
 * it has none or they may not read it.
 */
async function publishedDocument(
  ctx: PluginRouteContext,
  collection: string,
  id: string,
  locale: string
): Promise<Record<string, unknown> | undefined> {
  const published = await publishedWhere(ctx.services, collection);
  const result = await ctx.services.collections.listEntries(
    collection,
    {
      where: {
        and: [{ id: { equals: id } }, ...(published ? [published] : [])],
      },
      depth: 1,
      pagination: { limit: 1, page: 1 },
    },
    { as: "user", user: ctx.user ?? undefined, locale }
  );
  const first: unknown = (result.data as unknown[])[0];
  return isRecord(first) ? first : undefined;
}

/** The levels a design or the page's route outrank. */
const AUTOMATIC_LEVELS: ReadonlySet<SeoLevel> = new Set([
  "pattern",
  "content",
  "site",
]);

/**
 * Whether a value was worked out automatically, or there is none: either way
 * a design or the page's route may set one that wins.
 */
function isAutomatic(value: Sourced<unknown> | undefined): boolean {
  return value === undefined || AUTOMATIC_LEVELS.has(value.from);
}

/**
 * A Single's published document, read as the route's caller with the
 * Single's access and field rules enforced: nothing where it has none or
 * they may not read it.
 */
async function publishedSingle(
  ctx: PluginRouteContext,
  slug: string,
  locale: string
): Promise<Record<string, unknown> | undefined> {
  const identity = await signedIn(ctx).identity();
  const nextly = await getCachedNextly();
  try {
    const document: unknown = await nextly.findSingle({
      slug,
      createIfMissing: false,
      status: "published",
      depth: 1,
      locale,
      overrideAccess: false,
      user: identity.user,
      ...(identity.authenticatedScope === undefined
        ? {}
        : { actor: identity.authenticatedScope }),
    });
    return isRecord(document) ? document : undefined;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    if (NextlyError.isCode(error, "FORBIDDEN")) return undefined;
    throw error;
  }
}

/** What Nextly holds for a page, every address made absolute on `origin`. */
function storedHeadOf(answer: PageMetadataAnswer, origin: string): StoredHead {
  const at = (address: string) => new URL(address, origin).href;
  const image = answer.social?.image;
  const title = answer.title;
  const description = answer.description;
  const cardTitle = answer.social?.title ?? title;
  const cardDescription = answer.social?.description ?? description;
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(cardTitle === undefined ? {} : { cardTitle }),
    ...(cardDescription === undefined ? {} : { cardDescription }),
    ...(image === undefined
      ? {}
      : {
          image: {
            url: at(image.url),
            ...(image.width === undefined ? {} : { width: image.width }),
            ...(image.height === undefined ? {} : { height: image.height }),
          },
        }),
    ...(answer.canonical === undefined
      ? {}
      : { canonical: at(answer.canonical) }),
    listed: answer.robots?.index !== false,
  };
}

/**
 * The published document of the page `holder` names, as its route reads it,
 * where it is one of the plugin's types and the caller may read that type;
 * nothing otherwise.
 */
async function sourceOf(
  ctx: PluginRouteContext,
  holder: AddressHolder,
  locale: string,
  setup: ReceivedSetup
): Promise<PageMetadataInput["source"] | undefined> {
  const caller = signedIn(ctx);
  if (holder.collection.startsWith("single:")) {
    const single = holder.collection.slice("single:".length);
    if (!setup.singles.includes(single)) return undefined;
    if (!(await caller.can("read", single))) return undefined;
    const document = await publishedSingle(ctx, single, locale);
    return document === undefined
      ? undefined
      : { kind: "single", slug: single, document };
  }
  const collection = holder.collection;
  if (!setup.collections.includes(collection)) return undefined;
  if (!(await caller.can("read", collection, { anyEntry: true }))) {
    return undefined;
  }
  const entry = await publishedDocument(ctx, collection, holder.id, locale);
  return entry === undefined ? undefined : { kind: "entry", collection, entry };
}

/**
 * What Nextly holds for the page at `url`: the head the plugin answers for
 * the published page the address record says holds it, where the caller may
 * read that page's type. Nothing where no such page holds it.
 */
async function storedAt(
  ctx: PluginRouteContext,
  url: URL,
  setup: ReceivedSetup
): Promise<StoredHead | undefined> {
  const kept = await addressOfRequest(url);
  if (kept === undefined) return undefined;
  const path =
    kept.path.length > 1 && kept.path.endsWith("/")
      ? kept.path.slice(0, -1)
      : kept.path;
  for (const holder of await addressHolders(ctx, path, kept.locale)) {
    const source = await sourceOf(ctx, holder, kept.locale, setup);
    if (source === undefined) continue;
    // What the page's route supplies cannot be known here: it runs only
    // where the page is served. Its design is asked of the Page Builder.
    const input: PageMetadataInput = {
      path,
      locale: kept.locale,
      source,
      code: {},
      derived: await designLevelOf(ctx, source, kept.locale),
    };
    const answer = await setup.pageMetadata(ctx).resolve(input);
    // Where each value came from, so one Nextly worked out automatically is
    // said to be one a design or the route may set instead.
    const sourced = await resolveSeo(ctx, input, setup.readRules);
    return {
      ...storedHeadOf(answer, url.origin),
      automatic: {
        title: isAutomatic(sourced.title),
        description: isAutomatic(sourced.description),
        image: isAutomatic(sourced.image),
      },
    };
  }
  return undefined;
}

/**
 * The refusal every crawler met at the address itself, where they all met
 * the same one before any redirect: the address is refused as a whole.
 */
function refusedForAll(
  fetched: Record<CrawlerKey, Fetched>
): string | undefined {
  const all = Object.values(fetched);
  const first = all[0];
  if (first?.kind !== "failed") return undefined;
  const refusal = ["private", "no-answer"].includes(first.reason);
  const same = all.every(
    each =>
      each.kind === "failed" &&
      each.message === first.message &&
      each.redirects.length === 0
  );
  return refusal && same ? first.message : undefined;
}

/** Checks the page at `address` as each crawler. */
async function check(
  ctx: PluginRouteContext,
  address: string,
  setup: ReceivedSetup
): Promise<ReceivedAnswer> {
  const origins = await originsOf(ctx, setup);
  const url = addressToCheck(address, origins);
  if (!(url instanceof URL)) {
    return { kind: "refused", address, message: url.message };
  }
  const stored = await storedAt(ctx, url, setup);
  const fetched = Object.fromEntries(
    await Promise.all(
      CRAWLERS.map(async crawler => [
        crawler.key,
        await fetchAs(url, crawler.userAgent, { ...setup.fetch, origins }),
      ])
    )
  ) as Record<CrawlerKey, Fetched>;
  const refused = refusedForAll(fetched);
  if (refused !== undefined) {
    return { kind: "refused", address: url.href, message: refused };
  }
  const compared = compareReceived({
    address: url.href,
    ...(stored === undefined ? {} : { stored }),
    fetched,
  });
  return {
    kind: "checked",
    address: url.href,
    fetchedAt: new Date().toISOString(),
    ...(stored === undefined
      ? {}
      : {
          stored: {
            ...(stored.title === undefined ? {} : { title: stored.title }),
            ...(stored.description === undefined
              ? {}
              : { description: stored.description }),
            ...(stored.image === undefined ? {} : { image: stored.image }),
            ...(stored.canonical === undefined
              ? {}
              : { canonical: stored.canonical }),
            listed: stored.listed,
          },
        }),
    ...compared,
  };
}

/**
 * The screen's routes: the pages it offers, and the check. Both for someone
 * holding `check-seo`, since a check has the server fetch the site's pages.
 */
export function receivedRoutes(setup: ReceivedSetup): PluginRoute[] {
  return [
    {
      method: "GET",
      path: RECEIVED_PAGES_ROUTE_PATH,
      requiredPermission: CHECK_SEO_PERMISSION,
      handler: async (_req, ctx) => {
        signedIn(ctx);
        const origins = await originsOf(ctx, setup);
        const first = origins[0];
        const listed =
          first === undefined
            ? []
            : (
                await listPages(ctx, {
                  origin: first,
                  readRules: setup.readRules,
                  // The picker shows the first pages; the rest are not read.
                  limit: MAX_PAGES,
                })
              ).pages;
        const body: ReceivedPagesBody = {
          origins,
          pages: listed.slice(0, MAX_PAGES).map(page => page.loc),
        };
        return Response.json(body);
      },
    },
    {
      method: "POST",
      path: RECEIVED_ROUTE_PATH,
      requiredPermission: CHECK_SEO_PERMISSION,
      handler: async (req, ctx) => {
        signedIn(ctx);
        const { address } = await checkBody(req);
        // Each check fetches four times; a few at once is enough for a
        // screen a person opens, and keeps the server from being made to
        // fetch without end.
        if (running >= MAX_RUNNING) {
          throw NextlyError.rateLimited({
            retryAfterSeconds: 10,
            logContext: { reason: "seo-received-busy" },
          });
        }
        running++;
        try {
          return Response.json(await check(ctx, address, setup));
        } finally {
          running--;
        }
      },
    },
  ];
}
