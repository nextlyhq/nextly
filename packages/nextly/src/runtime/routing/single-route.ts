/**
 * `createSingleRoute` / `createPublicSingleRoute` — a route file for ONE
 * document that lives at ONE fixed address.
 *
 * A collection route resolves an unknown path against a slug field, because the
 * set of pages is open and authors add to it. A Single is the opposite: there
 * is exactly one of it, and the developer chose where it is served. So the
 * route file's own location IS the address, and these helpers fill its body.
 *
 * ## Neither factory returns `generateStaticParams`, and for a different reason
 * ## than the collection pair
 *
 * There is nothing to enumerate. A Single route has no dynamic segment, so it
 * has no params at all — Next already pre-renders such a route unless the render
 * marks itself dynamic. The posture difference here is therefore in the READ,
 * not in the params: an enforced route marks the render dynamic so it is
 * evaluated per visitor, while a public route leaves it alone and caches, so
 * Next may freeze it at build.
 *
 * ## Why two factories rather than one option
 *
 * The same reason the collection pair splits, and the same measurement: making
 * the posture a value means the config's type depends on it, which costs
 * contextual typing on every callback in the object (`render`, `buildMetadata`)
 * — they lose their parameter types. A differently-named function keeps both
 * signatures concrete and states the decision at the call site instead of
 * burying it in a flag.
 *
 * @module runtime/routing/single-route
 */
import type { Metadata } from "next";

import { runWithAccessMemo } from "../../auth/access/request-memo";
import { requireNextlyOnceStarted } from "../../direct-api/nextly";
import type { Nextly } from "../../direct-api/nextly";
import type { UserContext } from "../../direct-api/types/shared";
import { NextlyError } from "../../errors/nextly-error";
import { cachedFind } from "../cache/cached-find";
import { nextlySingleTags, readTags } from "../cache/nextly-tags";
import { releaseBoundedRevalidate } from "../cache/release-cache-window";
import {
  knownNoPageMetadataProvider,
  pageMetadataFor,
  pageStructuredDataFor,
  type PageMetadataRequest,
} from "../seo/page-metadata";
import type { PageMetadataValues } from "../seo/page-metadata-contract";

import { deferToRequest } from "./defer-to-request";
import { isMissOrDenied } from "./miss-or-denied";
import { triggerNotFound } from "./not-found";
import {
  confirmedLanguage,
  requestLanguage,
  type RequestLanguage,
} from "./request-language";

/** A resolved Single (loose by design — the shape is the app's own). */
export type SingleDocument = Record<string, unknown>;

/**
 * The booted-Nextly surface these helpers need.
 *
 * Typed structurally rather than as the Direct API class so BOTH the internal
 * singleton and the public instance returned by `await getNextly({ config })`
 * satisfy it — the public interface does not expose the Direct API's internal
 * handlers.
 */
export type NextlySingleReader = Pick<Nextly, "findSingle">;

/**
 * What a Single route hands its `draft` hook.
 *
 * A Single is addressed by slug and there is exactly one of it, so unlike a
 * collection path there is no id to resolve and nothing to compare afterwards —
 * the slug IS the identity, and the gate settles the whole question.
 */
/**
 * What a Single route's `draft` hook may answer.
 *
 * `false` refuses, and an object grants. The object exists so a grant can name
 * WHOSE field-level read rules the document is judged by: a granted draft read
 * is trusted, and trust switched field rules off with it, so the document came
 * back carrying every field — including any the person who shared the link
 * cannot see. A link was therefore a way to read past your own permissions by
 * sending yourself one.
 *
 * A bare `true` still grants, for a route mounted behind the application's own
 * auth where every visitor is already entitled to the draft. It names nobody,
 * so it judges by nobody, which is the pre-existing behaviour it preserves.
 *
 * Mirrors `DraftGrant` on the collection route, which carries the same identity
 * beside the entry id it has to name.
 */
export type SingleDraftGrant = boolean | { readAs: UserContext };

/** A normalized draft decision: `null` refuses, an object grants. */
type SingleDraftGrantResult = { readAs?: UserContext } | null;

/**
 * Read an app-supplied draft decision as RUNTIME INPUT.
 *
 * `SingleDraftGrant` is what the decision is declared to return, and a declared
 * type is not a runtime guarantee: the hook is application code, so a
 * JavaScript caller can answer anything. A `readAs` that is not an object would
 * otherwise be forwarded into the read as an identity and judged as one, and
 * `typeof null === "object"` makes the obvious check the wrong one.
 *
 * Normalized to ONE shape so the reader has a single thing to consult rather
 * than a three-way union threaded through every call: `null` refuses, an object
 * grants, and `readAs` is present only when the grant genuinely named someone.
 *
 * Extracted rather than inlined because it is the part worth testing on its
 * own — every branch here exists for a value the type says cannot arrive.
 */
export function normalizeSingleDraftGrant(
  grant: unknown
): SingleDraftGrantResult {
  if (grant === false || grant === undefined || grant === null) return null;
  // The empty grant is reserved for a LITERAL `true`, and that reservation is
  // the load-bearing part. An empty grant means "trusted read, judged by
  // nobody" — correct only where the application has said every visitor may see
  // the draft. An OBJECT grant is a hook trying to name someone, so a `readAs`
  // that is missing, null, or a primitive is a hook that failed to: normalizing
  // it to an empty grant would hand back the working draft with every field,
  // which is the disclosure this whole path exists to close. It refuses.
  if (grant === true) return {};
  if (typeof grant !== "object") return null;
  const readAs = (grant as { readAs?: unknown }).readAs;
  // A non-null object can still name NOBODY. `UserContext` requires a string
  // `id`, and an identity without one is judged as an anonymous-like user whose
  // every property is absent — where a rule such as `user?.role !== "restricted"`
  // PERMITS rather than denies. Absence is not the safe direction, so the id is
  // required rather than assumed. Arrays are objects too, and name nobody.
  if (
    typeof readAs !== "object" ||
    readAs === null ||
    Array.isArray(readAs) ||
    typeof (readAs as { id?: unknown }).id !== "string" ||
    (readAs as { id: string }).id.trim() === ""
  ) {
    return null;
  }
  return { readAs: readAs as UserContext };
}

export interface SingleDraftRequest {
  /** The Single's slug, as configured. */
  slug: string;
  /**
   * The locale this request reads in: the route's `[locale]` segment where it
   * has one, otherwise verbatim from the configuration.
   */
  locale?: string;
}

/** What `render` and `buildMetadata` are told about the document they got. */
export interface SingleContext {
  /** The Single's slug, as configured. */
  slug: string;
  /**
   * The locale this request is read in: the route's `[locale]` segment where
   * it has one, otherwise the locale it was configured to read in, verbatim.
   *
   * Carried explicitly rather than read back off the document: the localized
   * overlay copies translated values ONTO the row without stamping which locale
   * they came from, so a consumer inferring it would find nothing on exactly
   * the translated documents that need it.
   */
  locale?: string;
  /**
   * The page's structured data, as JSON-LD text written so that no value can
   * end its element: place it as the body of a JSON-LD script element, as a
   * content route's `context.structuredData` is placed. Read from the same
   * answer as the page's head; given to `render` only, and only where a
   * plugin provides page metadata and its answer has some.
   *
   * @experimental Settles with the page-metadata contract.
   */
  structuredData?: string;
}

/** Config for {@link createSingleRoute} and {@link createPublicSingleRoute}. */
export interface SingleRouteConfig<TNode> {
  /** Which Single to serve, by its slug. */
  slug: string;
  /** Render the resolved document (your server component's body). May be async. */
  render: (
    document: SingleDocument,
    context: SingleContext
  ) => TNode | Promise<TNode>;
  /**
   * Optional metadata for the page.
   *
   * Where a plugin provides page metadata, such as `@nextlyhq/plugin-seo`, its
   * answer decides the page's head and this is one of its inputs: the title,
   * description and social values set here are used where nobody set them for
   * the page; its `robots` may hide the page, never list one the answer hides,
   * and its other robots directives are kept; its canonical is kept only where
   * the answer names none. Without such a plugin, this is served as returned.
   */
  buildMetadata?: (
    document: SingleDocument,
    context: SingleContext
  ) => Metadata | Promise<Metadata>;
  /**
   * @experimental What the Single's own content offers for its head, such as
   * the title and image a Page Builder page's blocks show. Asked only where a
   * plugin provides page metadata, and handed to it as the level below every
   * value somebody set, as a content route's `derivedMetadata` is.
   */
  derivedMetadata?: (
    document: SingleDocument,
    context: SingleContext
  ) => PageMetadataValues | Promise<PageMetadataValues>;
  /**
   * The address this route serves the Single at, from `/`, where the page's
   * head should be answered for it: a later page of the Single's list, such
   * as `/blog/page/2` for a blog Single at `/blog`, is then its own page to
   * search engines, with its own canonical. Given as the address, or worked
   * out from the route's params for a route with a variable part.
   *
   * Left out, the page-metadata provider is asked without one and answers
   * for the Single's own address, which is right for a route served there.
   */
  path?: string | ((params: SingleRouteParams) => string);
  /**
   * A booted Nextly instance. Defaults to the runtime singleton, which requires
   * services to be registered — pass one explicitly (the value from
   * `await getNextly({ config })` from `nextly`) from a frontend that boots the
   * config itself,
   * because a public page can be the first request a cold server handles.
   */
  nextly?: NextlySingleReader;
  /**
   * Read this locale, and report it to `render` and `buildMetadata`.
   *
   * **State it on a localized site even when it is the default language.** The
   * read defaults an absent locale internally, so omitting it still serves the
   * right document — but nothing infers the default on your behalf, because
   * inferring it means reading configuration at request time and a reader may
   * defer booting until its first query, so that read answers differently on
   * the first request of a cold process than on the next one.
   *
   * A route under a `[locale]` segment reads the language from the segment
   * instead, so one route serves the Single in every language: leave this out
   * there.
   */
  locale?: string;
  /** Relation depth for the read. Defaults to the reader's own default. */
  depth?: number;
  /**
   * The collections this route's trust extends to, when it populates
   * relationships.
   *
   * **Defaults to NOTHING**, which is what a draft grant actually authorizes.
   * The grant names ONE document and says nothing about what that document
   * points at, so a target reached through a field is read the way an anonymous
   * visitor would read it: its own access rules apply, and only its published
   * rows come back.
   *
   * Without it a trusted read spreads to everything the Single populates, and a
   * caller who may preview this document receives related records they have no
   * permission to read at all.
   *
   * ```ts
   * // The landing page populates a featured post, and those are public.
   * createSingleRoute({
   *   slug: "landing-page",
   *   trustedCollections: ["posts"],
   *   draft: previewSingleDraftGate(),
   *   render: ...,
   * });
   * ```
   *
   * **This only ever narrows.** It is evaluated as
   * `overrideAccess && trusted(target)`, so naming a collection cannot grant
   * more than the read already holds, and it decides nothing on an enforced
   * read. Naming one does NOT admit its drafts: trusting a collection says its
   * published content may be shown, and nothing here widens a lifecycle.
   *
   * The same option, with the same meaning, as
   * `ContentRouteConfig.trustedCollections` — one question keeps one answer
   * whether the document came from a collection or is a Single.
   */
  trustedCollections?: string[];
  /** Identity to evaluate access rules against. Enforced routes only. */
  user?: UserContext;

  /**
   * Whether this request may read the Single's pending working draft.
   *
   * The argument is the point, not a convenience. Next's draft mode is a single
   * boolean for the whole host, so answering from `draftMode().isEnabled` alone
   * turns a link scoped to ONE unpublished document into a key to every
   * unpublished document on the site. A hook is asked per request instead, and
   * `previewSingleDraftGate()` is the implementation that answers it from the
   * visitor's own token.
   *
   * ```ts
   * createSingleRoute({
   *   slug: "homepage",
   *   render: doc => <Home {...doc} />,
   *   draft: previewSingleDraftGate(),
   * });
   * ```
   *
   * **A granted draft read is TRUSTED and UNCACHED**, and both follow from what
   * a draft is. Trusted, because this route resolves anonymously and the
   * working-draft overlay is gated on being able to edit the document — an
   * enforced draft read could only ever return the published values, so the
   * grant would appear to work and quietly show the wrong thing. Uncached,
   * because a draft is per-visitor by construction: writing one into the route
   * cache would serve it to everyone who asked next.
   *
   * `draft` belongs to this factory alone. `createPublicSingleRoute` refuses it,
   * for the same reason its content-route counterpart does.
   */
  draft?:
    | boolean
    | ((
        request: SingleDraftRequest
      ) => Promise<SingleDraftGrant> | SingleDraftGrant);
  /**
   * Extra cache tags for a public route, beyond the Single's own.
   *
   * The Single's tags are always included, so a write to it busts the page. Name
   * a related collection here when the render reads one, or a write there leaves
   * this page serving content that has moved on.
   */
  tags?: string[];
  /** Time-based revalidation for a public route. Tag-based busting needs none. */
  revalidate?: number | false;
}

/**
 * The params Next hands a Single's route: none at a fixed path, `locale`
 * under a `[locale]` segment, and whatever other variable parts the route's
 * folder has, such as `page` in `app/blog/page/[page]/page.tsx`.
 */
export type SingleRouteParams = Readonly<
  Record<string, string | string[] | undefined>
> & { readonly locale?: string };

/**
 * What Next hands a Single's page and `generateMetadata`: no params for a
 * route at a fixed path, `locale` for one under a `[locale]` segment, and the
 * route's other params, which `path` may read.
 */
export interface SingleRouteArgs {
  params?: Promise<SingleRouteParams> | SingleRouteParams;
}

/**
 * The parts of a Single route's config a page's answer is asked with: what
 * {@link singlePageMetadata} and {@link singlePageStructuredData} take.
 */
export type SinglePageAnswerConfig = Pick<
  SingleRouteConfig<unknown>,
  "buildMetadata" | "derivedMetadata" | "tags" | "revalidate"
>;

/**
 * What the page-metadata provider is asked about a Single, with the route's
 * own metadata; null for a process known to have no provider. The head and
 * the page's structured data are both asked with this, so they read one
 * answer.
 */
async function singlePageRequest(
  config: SinglePageAnswerConfig,
  document: SingleDocument,
  context: SingleContext,
  path: string | undefined
): Promise<{
  code: Metadata | undefined;
  request: PageMetadataRequest | null;
}> {
  const code = config.buildMetadata
    ? await config.buildMetadata(document, context)
    : undefined;
  // Worked out only where a provider may be asked: with none known, the
  // route's own metadata is served and the content is not walked for it.
  if (knownNoPageMetadataProvider()) return { code, request: null };
  const derived = config.derivedMetadata
    ? await config.derivedMetadata(document, context)
    : undefined;
  return {
    code,
    request: {
      // Without an address the provider finds the Single's own.
      ...(path === undefined ? {} : { path }),
      ...(context.locale === undefined ? {} : { locale: context.locale }),
      source: { kind: "single", slug: context.slug, document },
      code,
      ...(derived === undefined ? {} : { derived }),
      // The tags the document's own read carries, so a write to the Single
      // expires its head as it expires its body.
      tags: readTags(nextlySingleTags(context.slug), config.tags),
      ...(config.revalidate === undefined
        ? {}
        : { revalidate: config.revalidate }),
    },
  };
}

/**
 * The head of a Single a route read itself: the page-metadata provider's
 * answer where a plugin provides one, otherwise the route's own
 * `buildMetadata`, as returned. Asked exactly as a Single route asks, so a
 * site that renders its own pages serves the head a Single route would.
 *
 * `context.slug` names the Single. `path` is the address the request was
 * served at; left out, the provider answers for the Single's own address.
 *
 * ```ts
 * export async function generateMetadata() {
 *   const about = await nextly.findSingle({ slug: "about-page" });
 *   return singlePageMetadata(
 *     { buildMetadata: () => ({ title: "About" }) },
 *     about,
 *     { slug: "about-page" },
 *     "/about"
 *   );
 * }
 * ```
 *
 * @experimental Settles with the page-metadata contract.
 */
export async function singlePageMetadata(
  config: SinglePageAnswerConfig,
  document: SingleDocument,
  context: SingleContext,
  path?: string
): Promise<Metadata> {
  const { code, request } = await singlePageRequest(
    config,
    document,
    context,
    path
  );
  return request === null ? (code ?? {}) : pageMetadataFor(request);
}

/**
 * The structured data of a Single a route read itself, as the JSON-LD text a
 * Single route hands its `render` as `context.structuredData`: read from the
 * same answer as {@link singlePageMetadata} when asked with the same
 * arguments, and nothing without a provider.
 *
 * @experimental Settles with the page-metadata contract.
 */
export async function singlePageStructuredData(
  config: SinglePageAnswerConfig,
  document: SingleDocument,
  context: SingleContext,
  path?: string
): Promise<string | undefined> {
  // Nobody to answer: the route's own metadata is not worked out for nothing.
  if (knownNoPageMetadataProvider()) return undefined;
  const { request } = await singlePageRequest(config, document, context, path);
  return request === null ? undefined : pageStructuredDataFor(request);
}

/** What a Single route hands back for the route file to export. */
export interface SingleRoute<TNode> {
  /** The page component. Export as default. */
  SinglePage: (args?: SingleRouteArgs) => Promise<TNode>;
  /** Export as `generateMetadata`. */
  generateMetadata: (args?: SingleRouteArgs) => Promise<Metadata>;
}

function buildSingleRoute<TNode>(
  config: SingleRouteConfig<TNode>,
  posture: "restricted" | "public"
): SingleRoute<TNode> {
  const trusted = posture === "public";

  /** The reader, once Nextly has started. */
  const getReader = async (): Promise<NextlySingleReader> =>
    // Waits for a start in flight, as the start-up hook no longer holds
    // requests until Nextly has started.
    config.nextly ?? (await requireNextlyOnceStarted());

  /**
   * What `render`, `buildMetadata`, the draft decision and the read are told
   * for this request: its language, from the route's `[locale]` segment where
   * it has one. Not found where the segment names none of the site's
   * languages.
   */
  async function contextFor(
    args?: SingleRouteArgs
  ): Promise<{ context: SingleContext; language: RequestLanguage }> {
    const language = await requestLanguage(
      (await args?.params)?.locale,
      config.locale,
      getReader
    );
    if (language === null) triggerNotFound();
    return {
      language,
      context: {
        slug: config.slug,
        ...(language.locale === undefined ? {} : { locale: language.locale }),
      },
    };
  }

  /**
   * The document for this request, in its language: null where there is
   * none, or where a language read before Nextly had started turns out not
   * to be one of the site's.
   */
  async function documentFor(
    context: SingleContext,
    language: RequestLanguage
  ): Promise<SingleDocument | null> {
    const document = await resolve(context);
    return (await confirmedLanguage(language)) ? document : null;
  }

  /** Whether this request was granted the working draft, and as whom. */
  async function draftForThisRequest(
    context: SingleContext
  ): Promise<SingleDraftGrantResult> {
    const decision = config.draft;
    if (decision === undefined || decision === false) return null;
    if (decision === true) return {};
    return normalizeSingleDraftGrant(await decision({ ...context }));
  }

  /**
   * What this route asks the reader for, given whether a draft was granted.
   *
   * Separated from the read itself because the two fail differently and are
   * worth reading apart: this decides the POSTURE of the request, while `read`
   * below only classifies what came back.
   */
  // Built once: a `Set` lookup per populated target, and the same bound on every
  // read this route issues.
  const trustedSet = new Set(config.trustedCollections ?? []);

  // SORTED, so two routes stating the same trust in a different order share a
  // cache entry rather than warming two — the key names the policy, not the
  // spelling of it. Derived from the Set so it cannot drift from the predicate
  // above: one is the bound, the other is that bound's identity.
  const trustedKey = [...trustedSet].sort().join(",");

  function readArgs(grant: SingleDraftGrantResult, context: SingleContext) {
    const draft = grant !== null;
    return {
      slug: config.slug,
      // The bound travels WITH the widening. Passed on every read rather than
      // only the trusted ones, because it is evaluated as
      // `overrideAccess && trusted(target)` — inert when the read is enforced,
      // and impossible to forget on the one path where it matters.
      trusted: (collection: string): boolean => trustedSet.has(collection),
      // The posture, expressed to the reader. An enforced route asks as the
      // visitor would; a public route has stated that this Single is public.
      //
      // A granted draft read is trusted whatever the posture, because the
      // working-draft overlay is gated on being able to EDIT the document and
      // this route resolves anonymously. An enforced draft read would return the
      // published values while reporting success — the grant would look honoured
      // and show the wrong document.
      overrideAccess: trusted || draft,
      // Widened only for a granted draft, so a Single that has never been
      // published resolves at all. Left alone otherwise: widening it for every
      // read would serve unpublished content to ordinary visitors.
      ...(draft ? { draft: true, status: "all" as const } : {}),
      // The document stays trusted so the working draft appears at all; the
      // FIELDS are judged as the person who granted it. Named beside `user`
      // rather than folded into it, because that identity is a redaction basis
      // and not the caller: every hook goes on seeing the anonymous visitor who
      // is actually asking, and a hook-invented value need not be a declared
      // field, so redaction could not take it back.
      ...(grant?.readAs === undefined
        ? {}
        : { enforceFieldAccess: true, fieldAccessUser: grant.readAs }),
      ...(context.locale === undefined ? {} : { locale: context.locale }),
      ...(config.depth === undefined ? {} : { depth: config.depth }),
      ...(config.user === undefined ? {} : { user: config.user }),
    };
  }

  async function read(
    grant: SingleDraftGrantResult,
    context: SingleContext
  ): Promise<SingleDocument | null> {
    const reader = await getReader();
    try {
      const document = await reader.findSingle(readArgs(grant, context));
      return document ?? null;
    } catch (error) {
      if (isMissOrDenied(error)) return null;
      throw error;
    }
  }

  async function resolve(
    context: SingleContext
  ): Promise<SingleDocument | null> {
    const draft = await draftForThisRequest(context);

    // A draft is per-visitor by construction, so it must reach neither the data
    // cache nor the route cache: one cached draft is served to everyone who asks
    // next, which turns a link scoped to one reviewer into a site-wide leak of
    // unpublished content. Bypassing the data cache alone does not opt out of
    // the route cache, which is why this waits for the request as well.
    if (draft !== null) {
      await deferToRequest();
      return read(draft, context);
    }

    if (!trusted) {
      // An enforced read depends on who is asking, so it must not be frozen
      // into a build-time prerender or held in the route cache. Bypassing the
      // data cache alone does not opt out of the route cache, so this waits
      // for the request, and the read takes its clock after it.
      await deferToRequest();
      return read(null, context);
    }
    // Bounded by the next scheduled release, exactly as the collection route
    // is. A release member names either scope, so a Single without this keeps
    // serving its pre-release document until something unrelated busts a tag.
    const cacheSeconds = await releaseBoundedRevalidate(config.revalidate);
    return cachedFind(() => read(null, context), {
      tags: readTags(nextlySingleTags(config.slug), config.tags),
      // The locale is part of the key: one Single serves a different document
      // per language, and a key that omitted it would serve whichever language
      // warmed the cache first to everyone.
      //
      // The trust bound is part of it for the same reason, and it became one the
      // moment that bound started deciding what a read RETURNS. Two routes may
      // mount the same Single in the same language with different
      // `trustedCollections` — and without this the more-trusted one warms the
      // cache and the other is served its populated restricted rows, having
      // never run its own bound at all. A cache key has to name every input the
      // cached value depends on, and this is now one of them.
      keyParts: [
        "nextly-single",
        config.slug,
        context.locale ?? "",
        trustedKey,
      ],
      revalidate: cacheSeconds,
    });
  }

  /**
   * The address the app serves this request at, where it names one: as
   * given, or worked out from the request's params.
   */
  async function servedPathOf(
    args: SingleRouteArgs | undefined
  ): Promise<string | undefined> {
    const { path } = config;
    if (typeof path !== "function") return path;
    return path((await args?.params) ?? {});
  }

  async function generateMetadata(args?: SingleRouteArgs): Promise<Metadata> {
    // Nothing of its own to serve and no provider to ask: the document is not
    // read for its head at all, as before providers existed.
    if (!config.buildMetadata && knownNoPageMetadataProvider()) return {};
    // One memo of access lookups for the resolution and the callback, so a
    // preview's draft gate, the read it grants and any read the callback makes
    // look the person up once.
    const { context, language } = await contextFor(args);
    return runWithAccessMemo(async () => {
      const document = await documentFor(context, language);
      if (!document) return {};
      return singlePageMetadata(
        config,
        document,
        context,
        await servedPathOf(args)
      );
    });
  }

  async function SinglePage(args?: SingleRouteArgs): Promise<TNode> {
    const { context, language } = await contextFor(args);
    // One memo of access lookups for the resolution and the render; see
    // `generateMetadata`.
    return runWithAccessMemo(async () => {
      const document = await documentFor(context, language);
      if (!document) triggerNotFound();
      // Asked only where a provider may answer: a site with none renders as
      // it always has, and works nothing out for it.
      const structuredData = await singlePageStructuredData(
        config,
        document,
        context,
        await servedPathOf(args)
      );
      return config.render(
        document,
        structuredData === undefined ? context : { ...context, structuredData }
      );
    });
  }

  return { SinglePage, generateMetadata };
}

/**
 * A Single page over ACCESS-ENFORCED content — the secure default.
 *
 * The Single's read rules decide, so the answer depends on who is asking: the
 * read is not cached and the render is marked dynamic. The build therefore
 * touches no database, which is what lets an app using this build on a machine
 * that has none.
 *
 * For content that is wholly public and should be cached, use
 * {@link createPublicSingleRoute}.
 */
export function createSingleRoute<TNode>(
  config: SingleRouteConfig<TNode>
): SingleRoute<TNode> {
  return buildSingleRoute(config, "restricted");
}

/**
 * A Single page over PUBLIC content: trusted read, cached, pre-renderable.
 *
 * Access rules are not consulted — the site has stated that this Single is
 * public — which is what makes the read cacheable and the page pre-renderable.
 * It is busted by a write to the Single rather than by a timer, so publishing
 * updates the live page without a rebuild.
 *
 * Two consequences worth stating, because neither is visible at the call site:
 * the page is rendered during `next build`, so the build needs a reachable
 * database; and anything the render pulls in through a relationship is read
 * trusted as well, so a restricted row reached that way is written into a static
 * artifact and outlives being restricted.
 */
export function createPublicSingleRoute<TNode>(
  config: SingleRouteConfig<TNode>
): SingleRoute<TNode> {
  // Refused at construction rather than ignored at request time. A `user` asks
  // "what may THIS person see", and a trusted read has already answered "not
  // consulted" — so honouring both is impossible and silently dropping one
  // leaves a route whose config states a restriction it does not apply.
  // Refused for the reason a draft read cannot be public: it is per-visitor and
  // uncacheable, while this factory exists to be cached and pre-rendered. A
  // route that accepted both would either cache one reviewer's draft for
  // everyone or silently stop being static.
  if (config.draft !== undefined && config.draft !== false) {
    throw NextlyError.invalidInput({
      message:
        "createPublicSingleRoute() cannot serve drafts. Use " +
        "createSingleRoute() with `draft` and mount previewable Singles there.",
      logContext: {
        reason:
          "a draft read is per-visitor and uncacheable, which is incompatible " +
          "with a route whose whole purpose is to be cached and pre-rendered",
      },
    });
  }

  if (config.user !== undefined) {
    throw NextlyError.invalidInput({
      message:
        "createPublicSingleRoute() does not evaluate access rules, so `user` " +
        "would have no effect. Use createSingleRoute() to read as a visitor.",
      logContext: {
        reason:
          "a public route reads with overrideAccess, which bypasses the rules a " +
          "`user` exists to be evaluated against",
      },
    });
  }
  return buildSingleRoute(config, "public");
}
