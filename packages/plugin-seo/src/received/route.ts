/**
 * The route behind Inspect: the check, which fetches one of the site's pages
 * as Google, Bing, Facebook, X, LinkedIn and an AI crawler and compares what
 * each received with what Nextly holds for that page, its structured data
 * included.
 *
 * The address is refused before anything is fetched unless it is one of the
 * site's own pages (`addresses`), and every fetch is held to the same rule
 * hop by hop (`fetch`). What Nextly holds is the page's head as the plugin
 * answers it, read from the published page the address record says holds
 * the address, and only for a caller who may read that page's type. What
 * Nextly holds is answered even where the address is not fetched, so the
 * screen still shows it. The route is for someone holding `check-seo`.
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
import { CHECK_SEO_PERMISSION } from "../permissions";
import { isRecord as isPlainRecord, textOf } from "../plain-values";
import { SEO_TAB_ID } from "../problems/contract";
import { designLevelOf } from "../resolver/design-level";
import type { SeoLevel, Sourced } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import type { AiCrawlerChoice } from "../settings/contract";
import { publishedWhere } from "../sitemap";
import { STRUCTURED_DATA_TYPES } from "../structured-data/catalog";
import {
  structuredDataProblems,
  type StructuredDataReaders,
} from "../structured-data/provider";

import { addressToCheck } from "./addresses";
import { compareReceived, type StoredHead } from "./compare";
import {
  CRAWLERS,
  RECEIVED_ROUTE_PATH,
  type CrawlerKey,
  type Held,
  type HeldStructuredData,
  type ReceivedAnswer,
  type RowKey,
  type StoredValues,
  type ValueOrigin,
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
  /** What the problem list reads structured data with, for what a type is missing. */
  structuredDataReaders?: StructuredDataReaders;
  /** What robots.txt asks of AI crawlers until the settings choose: all allowed where unset. */
  aiCrawlers?: AiCrawlerChoice | undefined;
  /** How pages are fetched; the network itself unless a test says else. */
  fetch?: Pick<FetchOptions, "resolve" | "transport" | "limits">;
}

/** The most checks that may run at once, each fetching six times. */
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
    ...(answer.social?.locale === undefined
      ? {}
      : { locale: answer.social.locale }),
    ...(answer.social?.siteName === undefined
      ? {}
      : { siteName: answer.social.siteName }),
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

/** Where a value came from, as the screen names it. */
function valueOriginOf(
  value: Sourced<unknown> | undefined
): ValueOrigin | undefined {
  if (value === undefined) return undefined;
  return {
    level: value.from,
    ...(value.pattern === undefined ? {} : { pattern: value.pattern }),
    ...(value.field === undefined ? {} : { field: value.field }),
  };
}

/** What a page's head holds, as the screen shows it. */
function storedValuesOf(
  head: StoredHead,
  answer: PageMetadataAnswer,
  from: Partial<Record<RowKey, ValueOrigin | undefined>>
): StoredValues {
  return {
    ...(head.title === undefined ? {} : { title: head.title }),
    ...(head.description === undefined
      ? {}
      : { description: head.description }),
    ...(head.image === undefined ? {} : { image: head.image }),
    ...(head.canonical === undefined ? {} : { canonical: head.canonical }),
    listed: head.listed,
    followed: answer.robots?.follow !== false,
    ...(head.locale === undefined ? {} : { locale: head.locale }),
    ...(head.siteName === undefined ? {} : { siteName: head.siteName }),
    from: Object.fromEntries(
      Object.entries(from).filter(([, origin]) => origin !== undefined)
    ),
  };
}

/** The name a JSON-LD node goes by: its name, or an article's headline. */
function nodeName(node: Record<string, unknown>): string | undefined {
  return textOf(node.name) ?? textOf(node.headline);
}

/** A node's type, as JSON-LD writes one or several. */
function nodeType(node: Record<string, unknown>): string {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.filter(each => typeof each === "string").join(", ");
}

/** The page's structured data, and each type left out with what it misses. */
async function heldStructuredData(
  ctx: PluginContext,
  input: PageMetadataInput,
  answer: PageMetadataAnswer,
  readers: StructuredDataReaders | undefined
): Promise<HeldStructuredData> {
  const nodes = answer.structuredData ?? [];
  const problems = await structuredDataProblems(ctx, input, readers);
  return {
    items: nodes.filter(isPlainRecord).map(node => {
      const name = nodeName(node);
      return { type: nodeType(node), ...(name === undefined ? {} : { name }) };
    }),
    leftOut: problems.map(problem => ({
      type: STRUCTURED_DATA_TYPES[problem.type].schemaType,
      message: problem.message,
    })),
    json: JSON.stringify(
      { "@context": "https://schema.org", "@graph": nodes },
      null,
      2
    ),
  };
}

/** Where the page `source` names has its SEO edited, in its language. */
function editHrefOf(
  source: PageMetadataInput["source"],
  locale: string,
  defaultLanguage: string
): string {
  const page =
    source.kind === "single"
      ? `/admin/singles/${encodeURIComponent(source.slug)}`
      : `/admin/collections/${encodeURIComponent(source.collection)}/${encodeURIComponent(String(source.entry.id))}`;
  const query = new URLSearchParams({ tab: SEO_TAB_ID });
  if (locale !== defaultLanguage) query.set("locale", locale);
  return `${page}?${query.toString()}`;
}

/** The page's name, as its own title or name field gives it. */
function nameOf(source: PageMetadataInput["source"]): string | undefined {
  const document = source.kind === "single" ? source.document : source.entry;
  return textOf(document.title) ?? textOf(document.name);
}

/**
 * What Nextly holds for the page at `url`: the head the plugin answers for
 * the published page the address record says holds it, where the caller may
 * read that page's type, with where each value comes from and the page's
 * structured data; and the head again as the comparison reads it. Nothing
 * where no such page holds it.
 */
async function heldAt(
  ctx: PluginRouteContext,
  url: URL,
  setup: ReceivedSetup
): Promise<{ held: Held; head?: StoredHead }> {
  const kept = await addressOfRequest(url);
  if (kept === undefined) return { held: {} };
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
    const head: StoredHead = {
      ...storedHeadOf(answer, url.origin),
      automatic: {
        title: isAutomatic(sourced.title),
        description: isAutomatic(sourced.description),
        image: isAutomatic(sourced.image),
      },
    };
    const name = nameOf(source);
    return {
      head,
      held: {
        ...(name === undefined ? {} : { name }),
        editHref: editHrefOf(
          source,
          kept.locale,
          await ctx.publicAddresses.defaultLanguage()
        ),
        stored: storedValuesOf(head, answer, {
          title: valueOriginOf(sourced.title),
          description: valueOriginOf(sourced.description),
          image: valueOriginOf(sourced.image),
          canonical: valueOriginOf(sourced.canonical),
          robots: valueOriginOf(sourced.robots),
        }),
        structuredData: await heldStructuredData(
          ctx,
          input,
          answer,
          setup.structuredDataReaders
        ),
      },
    };
  }
  return { held: {} };
}

/** `value` as an address on one of the site's own hosts, where it is one. */
function ownAddress(
  value: string,
  origins: readonly string[]
): URL | undefined {
  try {
    const url = value.trim().startsWith("/")
      ? new URL(value.trim(), origins[0])
      : new URL(value.trim());
    return origins.some(origin => new URL(origin).hostname === url.hostname)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** What robots.txt asks of AI crawlers: the settings' choice, else the option's. */
async function aiCrawlersOf(
  ctx: PluginContext,
  setup: ReceivedSetup
): Promise<AiCrawlerChoice> {
  const rules = await setup.readRules(ctx, undefined);
  return rules.aiCrawlers ?? setup.aiCrawlers ?? "all";
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
    // Not fetched, but what Nextly holds at an address on the site itself
    // is still shown: one with a user name in it, or on another port.
    const own = origins.length === 0 ? undefined : ownAddress(address, origins);
    const { held } =
      own === undefined ? { held: {} } : await heldAt(ctx, own, setup);
    const first = origins[0];
    return {
      kind: "refused",
      address: own?.href ?? address,
      reason: url.reason,
      message: url.message,
      ...(first === undefined ? {} : { site: new URL(first).host }),
      ...held,
    };
  }
  const { held, head } = await heldAt(ctx, url, setup);
  const fetched = Object.fromEntries(
    await Promise.all(
      CRAWLERS.map(async crawler => [
        crawler.key,
        await fetchAs(url, crawler.userAgent, { ...setup.fetch, origins }),
      ])
    )
  ) as Record<CrawlerKey, Fetched>;
  const compared = compareReceived({
    address: url.href,
    ...(held.editHref === undefined ? {} : { editHref: held.editHref }),
    ...(head === undefined ? {} : { stored: head }),
    fetched,
  });
  return {
    kind: "checked",
    address: url.href,
    fetchedAt: new Date().toISOString(),
    aiCrawlers: await aiCrawlersOf(ctx, setup),
    ...held,
    ...compared,
  };
}

/**
 * Inspect's route: the check, for someone holding `check-seo`, since a
 * check has the server fetch the site's pages.
 */
export function receivedRoutes(setup: ReceivedSetup): PluginRoute[] {
  return [
    {
      method: "POST",
      path: RECEIVED_ROUTE_PATH,
      requiredPermission: CHECK_SEO_PERMISSION,
      handler: async (req, ctx) => {
        signedIn(ctx);
        const { address } = await checkBody(req);
        // Each check fetches six times; a few at once is enough for a
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
