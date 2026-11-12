/**
 * A page's head from the page-metadata provider: the one place the route
 * helpers ask it, and the one place its answer becomes Next.js `Metadata`.
 *
 * The route helpers call {@link pageMetadataFor} for every page they resolve.
 * With no provider started, it hands back the route's own metadata untouched,
 * so a site without one serves exactly what it served before. With one, the
 * provider decides, and the route's code is one of its inputs rather than the
 * answer: its title, description and social values are passed in at their own
 * level of the order of who wins, and its visibility and canonical are never
 * used, so the page and every output built from the same answer agree.
 *
 * The `next` import is type-only, like the rest of `runtime/seo`.
 *
 * @module runtime/seo/page-metadata
 */
import { createHash } from "node:crypto";

import type { Metadata } from "next";
import { z } from "zod";

import { getUnstableRethrow } from "../../actions/next-runtime";
import { NextlyError } from "../../errors/nextly-error";
import {
  capabilityProvider,
  capabilityProviderIdentity,
  capabilityProvidersRecorded,
} from "../../plugins/capabilities";
import { buildPluginServicesNamespace } from "../../plugins/services/plugin-services-registry";
import { consoleLogger } from "../../shared/types";
import { cachedFind } from "../cache/cached-find";
import { readTags } from "../cache/nextly-tags";

import { defined, isRecord, metadataFromAnswer } from "./answer-metadata";
import {
  PAGE_METADATA_CAPABILITY,
  PAGE_METADATA_SERVICE,
  type PageMetadataAnswer,
  type PageMetadataImage,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PageMetadataSource,
  type PageMetadataValues,
  type PageStructuredDataHints,
} from "./page-metadata-contract";
import { structuredDataText } from "./structured-data";

/**
 * A title as text: Next.js accepts a plain string or a template object, of
 * which only `absolute` and `default` are a title of this page.
 */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.absolute === "string") return value.absolute;
  if (typeof value.default === "string") return value.default;
  return undefined;
}

/** The first image of an Open Graph or Twitter `images` value. */
function firstImage(images: unknown): PageMetadataImage | undefined {
  const first: unknown = Array.isArray(images) ? images[0] : images;
  if (typeof first === "string") return { url: first };
  if (first instanceof URL) return { url: first.href };
  if (!isRecord(first)) return undefined;
  const url: unknown = first.url;
  const href =
    typeof url === "string" ? url : url instanceof URL ? url.href : undefined;
  if (href === undefined) return undefined;
  return defined({
    url: href,
    width: typeof first.width === "number" ? first.width : undefined,
    height: typeof first.height === "number" ? first.height : undefined,
    alt: typeof first.alt === "string" ? first.alt : undefined,
  }) as PageMetadataImage;
}

/**
 * What a route's code set that the order of who wins takes from code: a title,
 * a description and the social card's values. Visibility and the canonical are
 * deliberately not read, since only the answer decides them.
 */
function codeValuesOf(code: Metadata | undefined): PageMetadataValues {
  if (code === undefined) return {};
  const openGraph: Record<string, unknown> = isRecord(code.openGraph)
    ? code.openGraph
    : {};
  const twitter: Record<string, unknown> = isRecord(code.twitter)
    ? code.twitter
    : {};
  return defined({
    title: textOf(code.title),
    description:
      typeof code.description === "string" ? code.description : undefined,
    socialTitle: textOf(openGraph.title) ?? textOf(twitter.title),
    socialDescription:
      typeof openGraph.description === "string"
        ? openGraph.description
        : typeof twitter.description === "string"
          ? twitter.description
          : undefined,
    image: firstImage(openGraph.images) ?? firstImage(twitter.images),
  });
}

/** `record` without `keys`. */
function without<T extends Record<string, unknown>>(
  record: T,
  keys: readonly string[]
): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key))
  ) as Partial<T>;
}

/** The fields of a card a page's answer decides, and code therefore does not. */
const ANSWERED_CARD_FIELDS = ["title", "description", "images", "url"];

/**
 * The route's own metadata with the answer laid over it.
 *
 * What the answer decides is taken from the answer alone: the title and
 * description, visibility, the canonical, and the card's title, description,
 * image and address. Whatever else the route set, such as an Open Graph
 * `type` or keywords, stays, since the answer does not speak to it.
 */
function overCode(code: Metadata | undefined, answered: Metadata): Metadata {
  if (code === undefined) return answered;
  const {
    title: _title,
    description: _description,
    robots: _robots,
    alternates,
    openGraph,
    twitter,
    ...rest
  } = code;
  const merged: Metadata = { ...rest };
  if (answered.title !== undefined) merged.title = answered.title;
  if (answered.description !== undefined) {
    merged.description = answered.description;
  }
  if (answered.robots !== undefined) merged.robots = answered.robots;

  const keptAlternates = isRecord(alternates)
    ? without(alternates, ["canonical"])
    : {};
  const mergedAlternates = { ...keptAlternates, ...answered.alternates };
  if (Object.keys(mergedAlternates).length > 0) {
    merged.alternates = mergedAlternates;
  }

  const keptCard = isRecord(openGraph)
    ? without(openGraph, ANSWERED_CARD_FIELDS)
    : {};
  const mergedCard = { ...keptCard, ...answered.openGraph };
  if (Object.keys(mergedCard).length > 0) merged.openGraph = mergedCard;

  const keptTwitter = isRecord(twitter)
    ? without(twitter, ["title", "description", "images"])
    : {};
  const mergedTwitter = { ...keptTwitter, ...answered.twitter };
  if (Object.keys(mergedTwitter).length > 0) merged.twitter = mergedTwitter;

  return merged;
}

/** True for a value shaped like a resolver: `resolve` is the one it needs. */
function isResolver(value: unknown): value is PageMetadataResolver {
  return isRecord(value) && typeof value.resolve === "function";
}

/**
 * Whether this process is known to have no page-metadata provider: a boot has
 * recorded its providers and none provides it.
 *
 * Lets a route that supplies no metadata of its own skip resolving the page
 * for it, as it always has. Before a boot has recorded anything the answer is
 * unknown, and a route must resolve the page and ask: its reader may boot on
 * that very read.
 */
export function knownNoPageMetadataProvider(): boolean {
  return (
    capabilityProvidersRecorded() &&
    capabilityProvider(PAGE_METADATA_CAPABILITY) === undefined
  );
}

/**
 * The started page-metadata provider's resolver, or undefined when no plugin
 * provides one.
 *
 * Read from the provider record boot keeps, never from the configuration, so a
 * plugin that did not start is never asked.
 *
 * @throws NextlyError when the provider's service is not a resolver.
 */
function pageMetadataResolver(): PageMetadataResolver | undefined {
  const plugin = capabilityProvider(PAGE_METADATA_CAPABILITY);
  if (plugin === undefined) return undefined;
  const service =
    buildPluginServicesNamespace()[plugin]?.[PAGE_METADATA_SERVICE];
  if (!isResolver(service)) {
    throw NextlyError.internal({
      logContext: {
        plugin,
        reason: `"${PAGE_METADATA_SERVICE}" service has no resolve function`,
      },
    });
  }
  return service;
}

/**
 * JSON with object keys sorted at every depth, so the same input is the same
 * text however its objects were built.
 */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner) && !Array.isArray(inner) && !(inner instanceof Date)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        )
      : inner
  );
}

/**
 * The cache key of an answer: a hash of everything the provider was asked.
 *
 * Every input is in it, the document included, because the answer may depend
 * on any of it. A key naming the page alone would serve a draft's head to a
 * visitor of the published page, or one language's to another.
 */
function answerKey(input: PageMetadataInput): string {
  return createHash("sha256").update(sortedJson(input)).digest("hex");
}

/** What a route knows about a page it is asking the head of. */
export interface PageMetadataRequest {
  /** The address the route served the page at, when it knows it. */
  path?: string;
  locale?: string;
  source: PageMetadataSource;
  /** What the page's own content offers, such as a Page Builder page's blocks. */
  derived?: PageMetadataValues;
  /**
   * What the route says about the page for its structured data. Given only
   * when the structured data is asked for: it cannot change the head.
   */
  structuredDataHints?: PageStructuredDataHints;
  /** The route's own metadata, from its `buildMetadata`; undefined when none. */
  code: Metadata | undefined;
  /**
   * The cache tags of the page's own reads, so a write to its document expires
   * its head as it expires its body.
   */
  tags: readonly string[];
  /** Time-based revalidation for the cached answer, as the page's own reads. */
  revalidate?: number | false;
}

/** An image on a provider's social card, as the contract states it. */
const answerImageSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  alt: z.string().optional(),
});

/**
 * A provider's answer, parsed at the boundary as anything from outside core
 * is: a plugin's code returns it, and nothing about its shape is known until
 * it is read. Unknown keys are dropped; a value of the wrong kind refuses the
 * whole answer, which serves the route's own metadata instead.
 */
const pageMetadataAnswerSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  canonical: z.string().optional(),
  robots: z.object({ index: z.boolean(), follow: z.boolean() }).optional(),
  social: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      image: answerImageSchema.optional(),
      siteName: z.string().optional(),
      locale: z.string().optional(),
      type: z.enum(["website", "article"]).optional(),
    })
    .optional(),
  languages: z.record(z.string(), z.string()).optional(),
  // JSON only, the one form a cached answer and a script element both hold:
  // a node holding anything else refuses the answer.
  structuredData: z.array(z.record(z.string(), z.json())).optional(),
});

/**
 * The provider's answer for one page, cached; undefined when no provider is
 * started. Throws what the provider or the answer's parse throws.
 *
 * The answer is cached under the page's own tags and the ones the provider
 * names, so a change to the document or to anything the provider read expires
 * it, and a site's settings reach every page without a redeploy. The head and
 * the page's structured data are both read from here, so asked about the same
 * page they read one cached answer.
 */
async function pageAnswerFor(
  request: PageMetadataRequest
): Promise<PageMetadataAnswer | undefined> {
  const resolver = pageMetadataResolver();
  if (resolver === undefined) return undefined;
  const input: PageMetadataInput = {
    ...(request.path === undefined ? {} : { path: request.path }),
    ...(request.locale === undefined ? {} : { locale: request.locale }),
    source: request.source,
    code: codeValuesOf(request.code),
    derived: request.derived ?? {},
    // In the input, so in the answer's cache key: a page asked with what its
    // route lists is answered apart from its head, which is asked without.
    ...(request.structuredDataHints === undefined
      ? {}
      : { structuredDataHints: request.structuredDataHints }),
  };
  // Parsed inside the cached read, so an answer that is not one is refused
  // there and never stored: the next request asks the provider again.
  return cachedFind(
    async () => pageMetadataAnswerSchema.parse(await resolver.resolve(input)),
    {
      // The provider and its version too, so a replaced or upgraded provider
      // never reads an answer another one cached for the same page.
      keyParts: [
        "nextly-page-metadata",
        capabilityProviderIdentity(PAGE_METADATA_CAPABILITY) ?? "",
        answerKey(input),
      ],
      // The page's own tags first, so the one every write to its document
      // expires is never the one Next.js's per-read limit drops.
      tags: readTags(request.tags, resolver.tags?.(input) ?? []),
      ...(request.revalidate === undefined
        ? {}
        : { revalidate: request.revalidate }),
    }
  );
}

/**
 * The head of one page: the provider's answer over the route's own metadata,
 * or the route's own metadata unchanged when no provider is started.
 *
 * A provider that fails is logged and the route's own metadata is served: a
 * page loses its SEO answer for that render, never the page. Next.js's own
 * control-flow signals pass through untouched.
 */
export async function pageMetadataFor(
  request: PageMetadataRequest
): Promise<Metadata> {
  const { code } = request;
  try {
    const answer = await pageAnswerFor(request);
    if (answer === undefined) return code ?? {};
    return overCode(code, metadataFromAnswer(answer));
  } catch (error) {
    getUnstableRethrow()(error);
    consoleLogger.error(
      "The page-metadata provider could not answer; serving the route's own metadata.",
      { path: request.path, error }
    );
    return code ?? {};
  }
}

/**
 * The structured data of one page, as the text of its JSON-LD script element:
 * read from the same answer as the page's head, written so that no value can
 * end the element. Nothing when no provider is started or the answer has none.
 *
 * A provider that fails is logged and the page is rendered without it, as its
 * head is served without the answer.
 *
 * @experimental Settles with the page-metadata contract.
 */
export async function pageStructuredDataFor(
  request: PageMetadataRequest
): Promise<string | undefined> {
  try {
    return structuredDataText((await pageAnswerFor(request))?.structuredData);
  } catch (error) {
    getUnstableRethrow()(error);
    consoleLogger.error(
      "The page-metadata provider could not answer; rendering the page without structured data.",
      { path: request.path, error }
    );
    return undefined;
  }
}
