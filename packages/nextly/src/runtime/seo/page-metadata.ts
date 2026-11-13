/**
 * A page's head from the page-metadata provider: the one place the route
 * helpers ask it, and the one place its answer becomes Next.js `Metadata`.
 *
 * The route helpers call {@link pageMetadataFor} for every page they resolve.
 * With no provider started, it hands back the route's own metadata untouched,
 * so a site without one serves exactly what it served before. With one, the
 * provider decides, and the route's code is one of its inputs rather than the
 * answer: its title, description and social values are passed in at their own
 * level of the order of who wins. Its visibility is a floor: a route may hide
 * its page, never show one the answer hides. Its canonical is used only where
 * the answer has none.
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

/** Robots directives as Next.js's `robots` object spells them. */
type RobotsDirectives = Record<string, string | number | boolean>;

/** The robots words that set whether a page is listed, and its links followed. */
const ROBOTS_WORDS: Readonly<Record<string, RobotsDirectives>> = {
  all: { index: true, follow: true },
  none: { index: false, follow: false },
  index: { index: true },
  noindex: { index: false },
  follow: { follow: true },
  nofollow: { follow: false },
};

/**
 * Robots directives written as text, `"noindex, max-snippet:-1"`, as the
 * object Next.js reads: a word alone is set, a `name:value` pair keeps its
 * value, as a number where it is one.
 */
function directivesOfText(text: string): RobotsDirectives {
  const directives: RobotsDirectives = {};
  for (const part of text.split(",")) {
    const word = part.trim();
    if (word === "") continue;
    const colon = word.indexOf(":");
    if (colon === -1) {
      const name = word.toLowerCase();
      Object.assign(directives, ROBOTS_WORDS[name] ?? { [name]: true });
      continue;
    }
    const name = word.slice(0, colon).trim().toLowerCase();
    const value = word.slice(colon + 1).trim();
    const number = Number(value);
    directives[name] = value !== "" && Number.isFinite(number) ? number : value;
  }
  return directives;
}

/**
 * The directives of a route's `robots` value, given as text or as an object,
 * without Googlebot's own; undefined where it gives none. The deprecated
 * `noindex` and `nofollow` keys a JavaScript route may still pass are read as
 * the `index` and `follow` they stand for.
 */
function directivesOf(value: unknown): RobotsDirectives | undefined {
  if (typeof value === "string") return directivesOfText(value);
  if (!isRecord(value)) return undefined;
  const directives: RobotsDirectives = {};
  for (const [name, inner] of Object.entries(value)) {
    if (name === "googleBot" || name === "noindex" || name === "nofollow") {
      continue;
    }
    if (
      typeof inner === "string" ||
      typeof inner === "number" ||
      typeof inner === "boolean"
    ) {
      directives[name] = inner;
    }
  }
  if (value.noindex === true) directives.index = false;
  if (value.nofollow === true) directives.follow = false;
  return directives;
}

/**
 * The robots a page is served: the answer's visibility, with the route's own
 * as a floor, and every other directive the route gave, such as Google's
 * preview limits (`max-image-preview`, `max-snippet`), kept. A route may hide
 * its page or keep its links unfollowed, never list or follow what the answer
 * does not; Googlebot's own rule is held to the same floor and keeps its own
 * stricter values. With no visibility in the answer, the route's is served.
 */
function robotsOver(
  own: Metadata["robots"],
  answered: Metadata["robots"]
): Metadata["robots"] {
  const answer = directivesOf(answered);
  if (answer === undefined) return own;
  const code = directivesOf(own) ?? {};
  const index = answer.index !== false && code.index !== false;
  const follow = answer.follow !== false && code.follow !== false;
  const robots: Record<string, unknown> = { ...code, ...answer, index, follow };
  const googleBot = isRecord(own) ? own.googleBot : undefined;
  if (googleBot !== undefined) {
    const bot = directivesOf(googleBot) ?? {};
    robots.googleBot = {
      ...bot,
      index: index && bot.index !== false,
      follow: follow && bot.follow !== false,
    };
  }
  return robots;
}

/**
 * A title the answer decided, in the form it is served: whole, so a layout's
 * title template cannot add the site's name to a title that already carries
 * it. The route's own title is the exception, served as the route gave it,
 * so a page whose title its code still supplies reads as it did without a
 * provider.
 */
function servedTitle(
  answered: unknown,
  own: unknown
): Metadata["title"] | undefined {
  const text = textOf(answered);
  if (text === undefined) return undefined;
  if (textOf(own) === text) return own as Metadata["title"];
  return { absolute: text };
}

/**
 * What a route's code set that the order of who wins takes from code: a title,
 * a description, the social card's values, and whether it hides the page.
 * The canonical is not read: the answer decides it wherever it has one.
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
    hidden: directivesOf(code.robots)?.index === false ? true : undefined,
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
const ANSWERED_CARD_FIELDS = ["title", "description", "images"];

/**
 * A card of the route's own with the answer's laid over it: the answer's
 * title in the form it is served, and the route's address for the card where
 * the answer names no canonical.
 */
function cardOver(
  own: unknown,
  answered: unknown,
  answersAddress: boolean
): Record<string, unknown> | undefined {
  const kept = isRecord(own)
    ? without(own, [
        ...ANSWERED_CARD_FIELDS,
        ...(answersAddress ? ["url"] : []),
      ])
    : {};
  const answer = isRecord(answered) ? answered : {};
  const card: Record<string, unknown> = { ...kept, ...answer };
  const title = servedTitle(
    answer.title,
    isRecord(own) ? own.title : undefined
  );
  if (title !== undefined) card.title = title;
  return Object.keys(card).length > 0 ? card : undefined;
}

type Verification = NonNullable<Metadata["verification"]>;
type VerificationValue = NonNullable<Verification["other"]>[string];

/** A tag's values as a list, however the route gave them. */
function valuesOf(value: VerificationValue | undefined): (string | number)[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The route's own verification tags joined by the answer's. A name both set
 * keeps both values, since a service reads every tag of its name and two
 * owners may each have one; a value both set is written once.
 */
function verificationOver(
  own: Metadata["verification"],
  answered: Metadata["verification"]
): Metadata["verification"] {
  const added = answered?.other;
  if (added === undefined) return own;
  const other: Record<string, VerificationValue> = { ...own?.other };
  for (const [name, value] of Object.entries(added)) {
    const values = [...valuesOf(other[name])];
    for (const each of valuesOf(value)) {
      if (!values.includes(each)) values.push(each);
    }
    other[name] = values.length === 1 ? (values[0] ?? "") : values;
  }
  return { ...own, other };
}

/** `merged`, the route's own metadata, with the answer's verification tags joined to its own. */
function joinVerification(
  merged: Metadata,
  answered: Metadata["verification"]
): void {
  const joined = verificationOver(merged.verification, answered);
  if (joined !== undefined) merged.verification = joined;
}

/**
 * The route's own metadata with the answer laid over it.
 *
 * What the answer decides is taken from the answer: the title and
 * description, and the card's title, description and image. Its visibility is
 * served with the route's as a floor, and its canonical wherever it names one;
 * a page the answer gives no canonical, such as one whose type declares no
 * address, keeps the route's. Whatever else the route set, such as an Open
 * Graph `type`, keywords or Google's preview limits, stays, since the answer
 * does not speak to it.
 */
function overCode(code: Metadata | undefined, answered: Metadata): Metadata {
  const {
    title,
    description: _description,
    robots,
    alternates,
    openGraph,
    twitter,
    ...rest
  } = code ?? {};
  const merged: Metadata = { ...rest };
  const servedAs = servedTitle(answered.title, title);
  if (servedAs !== undefined) merged.title = servedAs;
  else if (title !== undefined) merged.title = title;
  if (answered.description !== undefined) {
    merged.description = answered.description;
  } else if (code?.description !== undefined) {
    merged.description = code.description;
  }
  const servedRobots = robotsOver(robots, answered.robots);
  if (servedRobots !== undefined && servedRobots !== null) {
    merged.robots = servedRobots;
  }

  const answersAddress = answered.alternates?.canonical !== undefined;
  const keptAlternates = isRecord(alternates)
    ? answersAddress
      ? without(alternates, ["canonical"])
      : alternates
    : {};
  const mergedAlternates = { ...keptAlternates, ...answered.alternates };
  if (Object.keys(mergedAlternates).length > 0) {
    merged.alternates = mergedAlternates;
  }

  joinVerification(merged, answered.verification);

  const card = cardOver(openGraph, answered.openGraph, answersAddress);
  if (card !== undefined) merged.openGraph = card as Metadata["openGraph"];
  const twitterCard = cardOver(twitter, answered.twitter, answersAddress);
  if (twitterCard !== undefined) {
    merged.twitter = twitterCard as Metadata["twitter"];
  }

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

/** Whether a worker that could not start Nextly has said so yet. */
let toldNotStarted = false;

/**
 * Start Nextly where no boot has recorded its providers yet, so a page is
 * asked of the provider rather than served the route's own head.
 *
 * A worker may serve a page before anything has started Nextly in it: every
 * read the page made was a cache hit, or `next build` is prerendering it where
 * `instrumentation.ts` does not run. Until a boot records the providers, a
 * provider cannot be told from none, so the start is made here, as the
 * site registered it, or awaited where one is under way. A start that cannot
 * be made leaves the route's own head served, and is said once per worker.
 */
async function startForProviders(path: string | undefined): Promise<void> {
  if (capabilityProvidersRecorded()) return;
  try {
    // Loaded here: Nextly's start imports the route helpers that import this.
    const { getCachedNextly } = await import("../../init");
    await getCachedNextly();
  } catch (error) {
    if (toldNotStarted) return;
    toldNotStarted = true;
    consoleLogger.warn(
      "Nextly could not be started to ask the page-metadata provider; serving the route's own metadata until it starts. Start it in instrumentation.ts, or register how the app starts it with registerNextlyStart.",
      { path, error }
    );
  }
}

/**
 * Whether a page-metadata provider can be asked for a page: its providers
 * settled first (`startForProviders`), so a worker nothing has started yet
 * starts Nextly before a route works out what the page's content offers a
 * provider, not after. A start that cannot be made leaves nobody to ask, so
 * that content is not read for an answer the route would never receive.
 */
export async function pageMetadataProviderToAsk(
  path: string | undefined
): Promise<boolean> {
  await startForProviders(path);
  return capabilityProvider(PAGE_METADATA_CAPABILITY) !== undefined;
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
  // Each name is one a meta tag can carry, so no name can reach the head as
  // anything but the name of one tag.
  verification: z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,99}$/), z.string())
    .optional(),
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
  await startForProviders(request.path);
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
