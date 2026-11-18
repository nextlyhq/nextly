/**
 * The site's one content route: every path the address store holds, a page's
 * or a collection entry's drawn with its own design or its collection's
 * template, and the design metadata an entry's page gives outside a route.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-content-route
 */
import type { Metadata } from "next";
import {
  cachedFind,
  contentPageMetadata,
  contentPageStructuredData,
  createContentRoute,
  createPublicContentRoute,
  deferToRequest,
  isDraftModeRequest,
  isReadRefusal,
  nextlyTags,
  releaseBoundedRevalidate,
  confirmedLanguage,
  requestLanguage,
  servedAddress,
  LIST_PAGE_SEGMENT,
  listPageNumber,
  listPageOf,
  slugToPath,
} from "nextly/runtime";
import type {
  ContentEntry,
  ContentRoute,
  ContentRouteArgs,
  ContentStaticParamsArgs,
  StaticContentRoute,
  ContentRouteConfig,
  PageMetadataValues,
  RenderContext,
  RequestLanguage,
} from "nextly/runtime";
import type { ReactElement } from "react";

import { blocksRouteConfig, perRequestNotFound } from "./next-blocks-route";
import { linkLanguageOf } from "./next-entry-paths";
import { FORM_DOCUMENT_KEY } from "./next-forms";
import type {
  BlocksPageConfig,
  ContentAddressHolder,
  ContentTemplate,
  ContentPageConfig,
} from "./next-page-config";
import { publicReaderFor } from "./next-readers";

/**
 * The key an entry's template document is handed to the shared render under:
 * a name no collection's field can take, so an entry's own field of the
 * same name is never drawn in its place.
 */
const TEMPLATE_DOCUMENT_KEY = "__nextlyTemplateDocument";

/** What a request path is served as. */
type ContentAnswer =
  | { readonly kind: "page" }
  | {
      readonly kind: "entry";
      readonly entry: ContentEntry;
      readonly context: RenderContext;
      readonly route: ContentRouteConfig<ReactElement>;
    }
  /** The first page of an entry's list under a second spelling. */
  | { readonly kind: "redirect"; readonly path: string };

/** Where on a document's page a path falls: its address, and a list page. */
interface ListPlace {
  /** The segments of the address the list is on. */
  readonly segments: readonly string[];
  /** The page of its list, absent for the address itself. */
  readonly page?: number;
}

/**
 * The page of a list `segments` names (`…/page/<n>`), as the route reads a
 * page number, or null where it names none: no `page/<n>` ending, or a
 * number written another way (`page/02`, `page/0`).
 */
function listPlaceOf(segments: readonly string[]): Required<ListPlace> | null {
  const later = listPageOf(segments.join("/"));
  const page = later === null ? null : listPageNumber(later.segment);
  return page === null ? null : { segments: segments.slice(0, -2), page };
}

/**
 * Where on an entry's page a path the store answers for it falls: its own
 * address (`segments`), or a later page of its list (`…/page/<n>`), which
 * the store answers as the entry's list space. Null for a path in the space
 * that names no page (`page/02`, `page/0`), which answers not found.
 */
function entryPlaceOf(
  segments: readonly string[],
  holder: ContentAddressHolder
): ListPlace | null {
  return holder.kind === "space" ? listPlaceOf(segments) : { segments };
}

/** The segments of page `page` of the list on the page at `segments`. */
function listPageSegments(
  segments: readonly string[],
  page: number
): readonly string[] {
  return page <= 1 ? segments : [...segments, LIST_PAGE_SEGMENT, String(page)];
}

/**
 * Answer not found: with the route's own `notFound` where the site passed
 * one, then through the App Router's own boundary, so a handler that returns
 * still leaves the request answered not found.
 */
async function contentNotFound(
  handler: ContentPageConfig["notFound"]
): Promise<never> {
  if (handler !== undefined) await handler();
  const { notFound } = await import("next/navigation");
  return notFound();
}

/** Redirect permanently to `path`, through the App Router. */
async function contentRedirect(path: string): Promise<never> {
  const { permanentRedirect } = await import("next/navigation");
  return permanentRedirect(path);
}

/**
 * The site's handler a content route answers its misses with: the route's
 * own, else its pages route's.
 */
export function contentMissHandler(
  config: ContentPageConfig
): ContentPageConfig["notFound"] {
  return config.notFound ?? config.pages.notFound;
}

export function buildContentRoute(
  config: ContentPageConfig,
  isPublic: boolean
): StaticContentRoute<ReactElement> {
  const { templates } = config;
  const entryPath = config.entryPath;
  /**
   * How the route answers a miss: the site's handler, where it passed one
   * and the route answers misses per request.
   */
  const notFound = perRequestNotFound(contentMissHandler(config), isPublic);
  /**
   * The tags a cached read of the address store carries: every collection
   * whose writes change who holds an address (the pages', the templates', and
   * each the store names), so any write that moves an address refreshes it.
   */
  const addressTags = async (): Promise<string[]> => {
    const collections = [
      ...config.pages.collections,
      templates.collection,
      ...((await config.addressCollections?.()) ?? []),
    ];
    return [...new Set(collections)].flatMap(slug => nextlyTags(slug));
  };
  /**
   * The entry `id` of `collection` as a visitor reads it: published, with
   * the fields the public may read, or null where the public may read none.
   * The one read that decides whether an entry is served, and whether a link
   * to it is drawn.
   */
  const publicRead = async (
    collection: string,
    id: string,
    select?: readonly string[],
    locale: string | undefined = config.pages.locale
  ): Promise<ContentEntry | null> => {
    const { items } = await publicReaderFor(
      config.pages,
      locale,
      config.pages.revalidate
    ).find({
      collection,
      filters: [{ field: "id", op: "equals", value: id }],
      limit: 1,
      ...(select === undefined ? {} : { select }),
    });
    return items[0] ?? null;
  };
  // A link to a page or an entry names the address it is served at, from the
  // same store that routes, so a post's link to another post carries its
  // collection's address. Cached on a public route, under the store's tags.
  // Drawn only to a target the public may read, as the route serves it: a
  // restricted entry's address is never published in a link.
  const pages: BlocksPageConfig =
    config.pages.resolveEntryPath !== undefined || entryPath === undefined
      ? config.pages
      : {
          ...config.pages,
          resolveEntryPath: async (collection, id, drawnIn) => {
            // Read in the language the page is drawn in: a target is
            // published, and holds its address, per language.
            const locale = drawnIn ?? config.pages.locale;
            // A read the public is refused outright (a collection it may not
            // read at all, or one that no longer exists) is no target either:
            // a link resolver answers null where there is no path to draw.
            const target = await publicRead(
              collection,
              id,
              ["id"],
              locale
            ).catch(() => null);
            if (target === null) return null;
            // The path the store holds, at the address the route serves it
            // at in that language, as the route's own redirects and head are.
            const language = linkLanguageOf(config.pages.locale, drawnIn);
            const read = async () => {
              const path = await entryPath(collection, id, locale);
              return path === null ? null : await servedAddress(path, language);
            };
            if (!isPublic) return await read();
            return await cachedFind(read, {
              tags: await addressTags(),
              keyParts: [
                "nextly-content-entry-path",
                config.pages.cacheScope ?? "",
                locale ?? "",
                // Formed for a segment's request, or left as the path.
                language.fromSegment ? "formed" : "",
                collection,
                id,
              ],
              revalidate: await releaseBoundedRevalidate(
                config.pages.revalidate
              ),
            });
          },
        };
  // A page is served by the pages route itself, so it is drawn exactly as
  // `createBlocksPage` draws it: its draft gate, its list's later pages, its
  // tags and metadata.
  //
  // Its misses are answered as the route's own are, by the one handler.
  const pagesConfig: BlocksPageConfig =
    notFound === undefined ? pages : { ...pages, notFound };
  const pagesRoute: ContentRoute<ReactElement> &
    Partial<Pick<StaticContentRoute<ReactElement>, "generateStaticParams">> =
    isPublic
      ? createPublicContentRoute<ReactElement>(
          blocksRouteConfig(pagesConfig, true)
        )
      : createContentRoute<ReactElement>(blocksRouteConfig(pagesConfig, false));
  const pageCollections = new Set(pages.collections);
  const mountPath = pages.mountPath ?? "";
  const mountSegments = mountPath.split("/").filter(part => part !== "");
  const window = pages.revalidate;
  // An entry is drawn by the same render as a page, over its collection, with
  // the design serving it as the document. A page's stored sheet is not an
  // entry's.
  const { styles: _styles, ...entryOptions } = pages;
  const entryRoutes = new Map<string, ContentRouteConfig<ReactElement>>();
  const entryRouteOf = (
    collection: string
  ): ContentRouteConfig<ReactElement> => {
    let route = entryRoutes.get(collection);
    if (route === undefined) {
      route = blocksRouteConfig(
        {
          ...entryOptions,
          collections: [collection],
          field: TEMPLATE_DOCUMENT_KEY,
        },
        isPublic
      );
      entryRoutes.set(collection, route);
    }
    return route;
  };

  /**
   * Who holds `path` in `locale`: read per request, or cached on a public
   * route.
   */
  async function holderOf(
    path: string,
    locale: string | undefined
  ): Promise<ContentAddressHolder | null> {
    const read = () => config.resolveAddress(locale, path);
    if (!isPublic) {
      // Read at request time, after the request: under Cache Components a
      // prerender refuses an uncached read, which takes the current time.
      await deferToRequest();
      return await read();
    }
    // `null` stands for "nobody" inside the cache, which keeps values as JSON.
    return await cachedFind(async () => (await read()) ?? null, {
      tags: await addressTags(),
      keyParts: [
        "nextly-content-address",
        pages.cacheScope ?? "",
        locale ?? "",
        path,
      ],
      revalidate: await releaseBoundedRevalidate(window),
    });
  }

  /**
   * `collection`'s published template in `locale`, cached and tagged with
   * templates.
   */
  async function templateOf(
    collection: string,
    locale: string | undefined
  ): Promise<ContentTemplate | null> {
    return await cachedFind(
      async () => (await templates.read(collection, locale)) ?? null,
      {
        tags: nextlyTags(templates.collection),
        keyParts: [
          "nextly-content-template",
          pages.cacheScope ?? "",
          locale ?? "",
          collection,
        ],
        revalidate: await releaseBoundedRevalidate(window),
      }
    );
  }

  /**
   * What draws the entry `id` of `collection`: its own published design, or
   * else its collection's published template, as the provider's `readFor`
   * answers. Cached per entry, since two entries of one collection may be
   * drawn with different designs, and tagged with templates, so publishing,
   * unpublishing or removing an own design or the template refreshes it.
   *
   * Published only, on a route whose draft gate grants previews too, as a
   * collection's template is: the gate speaks for pages, and a design's
   * working draft is previewed in the editor, which draws it itself. A
   * provider without `readFor` draws every entry with its collection's
   * template.
   */
  async function designOf(
    collection: string,
    id: string,
    locale: string | undefined
  ): Promise<ContentTemplate | null> {
    const readFor = templates.readFor;
    if (readFor === undefined) return await templateOf(collection, locale);
    return await cachedFind(
      async () => (await readFor(collection, id, locale)) ?? null,
      {
        tags: nextlyTags(templates.collection),
        keyParts: [
          "nextly-content-design",
          pages.cacheScope ?? "",
          locale ?? "",
          collection,
          id,
        ],
        revalidate: await releaseBoundedRevalidate(window),
      }
    );
  }

  /**
   * Whether the pages route's draft gate grants this path to the request: a
   * page's working draft holds no address, so a preview of one reaches the
   * pages route only through its gate.
   */
  async function draftGranted(
    slug: string,
    locale: string | undefined
  ): Promise<boolean> {
    const decision = pages.draft;
    if (decision === undefined || decision === false) return false;
    if (decision === true) return true;
    // The public route asks its gate only on a draft-mode request, as the
    // pages route under it does, so an ordinary visit reads no cookie and its
    // answer stays static and cached.
    if (isPublic && !(await isDraftModeRequest())) return false;
    for (const collection of pageCollections) {
      const grant = await decision({
        collection,
        slug,
        ...(locale === undefined ? {} : { locale }),
      });
      if (
        grant === true ||
        (typeof grant === "object" &&
          grant !== null &&
          typeof grant.entryId === "string" &&
          grant.entryId !== "")
      ) {
        return true;
      }
    }
    return false;
  }

  /** What `segments` is served as in `language`, or null for not found. */
  async function answer(
    segments: readonly string[],
    language: RequestLanguage
  ): Promise<ContentAnswer | null> {
    const slug = segments.join("/");
    // The address store's own answer to which paths it holds, asked of the
    // whole path a visitor requested, mount included: a reserved path, or a
    // segment URL resolution removes, is never looked up.
    const served = [...mountSegments, ...segments].join("/");
    if (slugToPath(served) === null) return null;
    const holder = await holderOf(pathOf(segments), language.locale);
    if (holder !== null && pageCollections.has(holder.collection)) {
      return { kind: "page" };
    }
    // A page's draft holds no address, so a preview of one is asked of the
    // pages route's gate before any other holder is served: the preview
    // shows the page, and its publish is what a clash refuses.
    if (await draftGranted(slug, language.locale)) return { kind: "page" };
    if (holder === null) return await firstListPage(segments, language);
    const place = entryPlaceOf(segments, holder);
    return place === null ? null : await entryAnswer(holder, place, language);
  }

  /**
   * What `segments` is served as where the store holds it for no one, when
   * it is the first page of a list under a second spelling (`…/page/1`):
   * no claim holds it, since a list's first page is its document's own
   * address and the list's space starts at page 2. So it is answered as the
   * document at that address answers it: a page by the pages route, which
   * redirects there, an entry by its list's own pages; anything else, or
   * any other path, is not found.
   */
  async function firstListPage(
    segments: readonly string[],
    language: RequestLanguage
  ): Promise<ContentAnswer | null> {
    const place = listPlaceOf(segments);
    if (place === null || place.page !== 1) return null;
    const holder = await holderOf(pathOf(place.segments), language.locale);
    if (holder === null || holder.kind === "space") return null;
    if (pageCollections.has(holder.collection)) return { kind: "page" };
    return await entryAnswer(holder, place, language);
  }

  /**
   * Whether the store gives the entry `holder` the later pages of its list
   * on the page at `segments`: one lookup of the list's second page, which
   * the store answers with the space's holder, as it answers every later
   * page. Until it does (a document is published among them, and the entry
   * waits for it), the entry's list is drawn unpaged.
   */
  async function holdsLaterPages(
    holder: ContentAddressHolder,
    segments: readonly string[],
    locale: string | undefined
  ): Promise<boolean> {
    const second = await holderOf(
      pathOf(listPageSegments(segments, 2)),
      locale
    );
    return (
      second?.kind === "space" &&
      second.collection === holder.collection &&
      second.id === holder.id
    );
  }

  /**
   * What `place`, held by a collection's entry, is served as: the entry
   * drawn with the design serving it, at its own address or on a page of its
   * list; or null for not found.
   */
  async function entryAnswer(
    holder: ContentAddressHolder,
    place: ListPlace,
    language: RequestLanguage
  ): Promise<ContentAnswer | null> {
    const template = await designOf(
      holder.collection,
      holder.id,
      language.locale
    );
    if (template === null) return null;
    // An entry the public may not read answers not found, as an unpublished
    // one does, so the answer never tells a visitor what access hides. Any
    // other failure throws: answered as not found, a fault would be cached as
    // a missing page.
    const entry = await publicRead(
      holder.collection,
      holder.id,
      undefined,
      language.locale
    ).catch((error: unknown) => {
      if (isReadRefusal(error)) return null;
      throw error;
    });
    if (entry === null) return null;
    const route = entryRouteOf(holder.collection);
    // A later page's lookup was answered with the entry's space; its own
    // address, and the first page's second spelling, ask the store.
    const paged =
      holder.kind === "space" ||
      (await holdsLaterPages(holder, place.segments, language.locale));
    // The entry's own address in the request's language, which its list's
    // later pages extend.
    const first = await servedAddress(pathOf(place.segments), language);
    const drawn = {
      ...entry,
      [TEMPLATE_DOCUMENT_KEY]: template.document,
      // The entry drawn by its design: a form on the design, or in the
      // entry's own blocks the design draws, posts naming the entry, which
      // the receiver draws as this page does.
      [FORM_DOCUMENT_KEY]: {
        collection: holder.collection,
        id: holder.id,
        field: "",
        design: true,
        // The entry's own address as this route serves it, its mount
        // included, which a visitor sending a form comes back to.
        returnTo: first,
      },
    };
    // The addresses of the entry's list pages, as this route serves them, so
    // the list's links name exactly the pages the store gives the entry, and
    // none while it gives the entry none: the list is then drawn unpaged.
    const context: RenderContext = {
      collection: holder.collection,
      slug: place.segments.join("/"),
      ...(language.locale === undefined ? {} : { locale: language.locale }),
      ...(paged
        ? {
            listPagePath: (page: number) =>
              page <= 1
                ? first
                : `${first === "/" ? "" : first}/${LIST_PAGE_SEGMENT}/${String(page)}`,
          }
        : {}),
    };
    if (place.page === undefined) {
      return { kind: "entry", route, entry: drawn, context };
    }
    if (!paged) return null;
    return await entryListPage(
      route,
      drawn,
      context,
      { segments: place.segments, page: place.page },
      language
    );
  }

  /**
   * The path `segments` (under this route's mount) is served at, as the
   * address store keys it: the mount, then each segment percent-encoded as
   * a request carries it. The path a lookup asks for, and the one an
   * entry's list links to and redirects to.
   */
  function pathOf(segments: readonly string[]): string {
    const own = segments.map(encodeURIComponent).join("/");
    return own === "" ? mountPath || "/" : `${mountPath}/${own}`;
  }

  /**
   * Page `page` of the list on an entry's page, drawn with the design
   * serving the entry, as a page's later pages are: counted as the list
   * itself counts, so the route serves exactly the pages the list's links
   * name. Page 1 under this spelling redirects to the entry's own address,
   * and a page past the last, or of a design that splits no list, answers
   * not found.
   */
  async function entryListPage(
    route: ContentRouteConfig<ReactElement>,
    entry: ContentEntry,
    context: RenderContext,
    place: { readonly segments: readonly string[]; readonly page: number },
    language: RequestLanguage
  ): Promise<ContentAnswer | null> {
    const { page } = place;
    const count = (await route.listPages?.(entry, context)) ?? null;
    if (count === null || page > count) return null;
    if (page === 1) {
      return {
        kind: "redirect",
        path: await servedAddress(pathOf(place.segments), language),
      };
    }
    return {
      kind: "entry",
      route,
      entry,
      context: { ...context, page, listPages: count },
    };
  }

  /**
   * The path a request names, its language (from a `[locale]` segment where
   * the route sits under one), and the params the pages route is handed; null
   * where the segment names none of the site's languages.
   */
  async function requestOf(args: ContentRouteArgs): Promise<{
    segments: string[];
    language: RequestLanguage;
    params: { slug: string[]; locale?: string };
  } | null> {
    const params = await args.params;
    const segments = params.slug ?? [];
    const language = await requestLanguage(
      params.locale,
      pages.locale,
      pages.nextly === undefined
        ? undefined
        : () => Promise.resolve(pages.nextly)
    );
    if (language === null) return null;
    return {
      segments,
      language,
      params: {
        slug: segments,
        ...(params.locale === undefined ? {} : { locale: params.locale }),
      },
    };
  }

  /**
   * What `segments` is served as in `language`, or null for not found,
   * including where a language read before Nextly had started turns out,
   * once the lookup has started it, not to be one of the site's.
   */
  async function answered(
    segments: readonly string[],
    language: RequestLanguage
  ): Promise<ContentAnswer | null> {
    const found = await answer(segments, language);
    return (await confirmedLanguage(language)) ? found : null;
  }

  /**
   * What a request is served as, with its path, language and params; not
   * found, through the route's handler, where it names nothing the route
   * serves. The page and its head ask alike: a crawler is answered once its
   * head is ready, so the head answering not found is what gives it a 404
   * rather than a 200 carrying a not-found body.
   */
  async function servedFor(args: ContentRouteArgs): Promise<{
    found: ContentAnswer;
    segments: string[];
    language: RequestLanguage;
    params: { slug: string[]; locale?: string };
  }> {
    const request = await requestOf(args);
    if (request === null) return await contentNotFound(notFound);
    const found = await answered(request.segments, request.language);
    if (found === null) return await contentNotFound(notFound);
    return { ...request, found };
  }

  async function ContentPage(args: ContentRouteArgs): Promise<ReactElement> {
    const { found, segments, language, params } = await servedFor(args);
    if (found.kind === "page") {
      return await pagesRoute.ContentPage({ params });
    }
    if (found.kind === "redirect") return await contentRedirect(found.path);
    // An entry is served here rather than by a content route, so its
    // structured data is asked as its head is (`generateMetadata` below),
    // at the address it was served at, and handed to the render as a
    // content route hands it.
    const structuredData = await contentPageStructuredData(
      found.route,
      found.entry,
      found.context,
      await servedAddress(pathOf(segments), language)
    );
    return await found.route.render(
      found.entry,
      structuredData === undefined
        ? found.context
        : { ...found.context, structuredData }
    );
  }

  async function generateMetadata(args: ContentRouteArgs): Promise<Metadata> {
    // Not found here as in the page (`servedFor`).
    const { found, segments, language, params } = await servedFor(args);
    // A redirect's metadata is never read: the page answers with it.
    if (found.kind === "redirect") return {};
    if (found.kind === "page") {
      return await pagesRoute.generateMetadata({ params });
    }
    // Asked as the pages route asks for a page, so an entry served here gets
    // the page-metadata provider's answer, told the address it was served at.
    return await contentPageMetadata(
      found.route,
      found.entry,
      found.context,
      await servedAddress(pathOf(segments), language)
    );
  }

  async function generateStaticParams(
    args?: ContentStaticParamsArgs
  ): Promise<Array<{ slug: string[] }>> {
    // The pages' own params, as the pages route builds them: its pages and
    // their lists' later pages, which the store holds as one space each and
    // cannot enumerate. Under a `[locale]` segment, in the language its
    // layout hands here.
    const own = (await pagesRoute.generateStaticParams?.(args)) ?? [];
    const limit = pages.staticParamsLimit ?? 1000;
    if (config.addresses === undefined || limit <= 0) return own;
    const language = await requestLanguage(
      (await args?.params)?.locale,
      pages.locale,
      pages.nextly === undefined
        ? undefined
        : () => Promise.resolve(pages.nextly)
    );
    if (language === null) return own;
    const held = await config.addresses(language.locale, limit, mountSegments);
    // A language read before Nextly had started builds none of its own
    // addresses if it is not one of the site's.
    if (!(await confirmedLanguage(language))) return own;
    // Then the entries' addresses under this route's mount, as the route
    // serves them, each listed once.
    const listed = new Set(own.map(param => param.slug.join("/")));
    const entries = held.flatMap(segments => {
      if (!mountSegments.every((part, at) => segments[at] === part)) return [];
      const slug = segments.slice(mountSegments.length);
      const key = slug.join("/");
      if (listed.has(key)) return [];
      listed.add(key);
      return [{ slug }];
    });
    return [...own, ...entries];
  }

  return { ContentPage, generateMetadata, generateStaticParams };
}

/**
 * What one entry's page says about itself through its blocks: the title,
 * description and image a Page Builder route hands a page-metadata provider
 * as the page's design level, asked outside a route.
 *
 * Worked out by the route's own derivation, so an admin screen or a check
 * that asks reads the same values the published page is answered with:
 * `field` names the entry's own blocks field a page draws, or `document` is
 * the design drawing the entry (its collection's template, or its own
 * design), as `createContentPage` draws one. The page is read as an
 * access-enforced route reads it, through `config.nextly`.
 *
 * @experimental Settles with the page-metadata contract.
 */
export async function designMetadataFor(args: {
  readonly config: Omit<BlocksPageConfig, "collections" | "field">;
  readonly collection: string;
  readonly entry: ContentEntry;
  readonly locale?: string;
  readonly field?: string;
  readonly document?: unknown;
}): Promise<PageMetadataValues> {
  const drawsDesign = args.document !== undefined;
  const field = drawsDesign ? TEMPLATE_DOCUMENT_KEY : args.field;
  if (field === undefined) return {};
  const route = blocksRouteConfig(
    { ...args.config, collections: [args.collection], field },
    false
  );
  // The design handed to the shared derivation under the key no field can
  // take, as the content route hands an entry's design to its render.
  const entry = drawsDesign
    ? { ...args.entry, [TEMPLATE_DOCUMENT_KEY]: args.document }
    : args.entry;
  const slug = args.entry.slug;
  return (
    (await route.derivedMetadata?.(entry, {
      collection: args.collection,
      slug: typeof slug === "string" ? slug : "",
      ...(args.locale === undefined ? {} : { locale: args.locale }),
    })) ?? {}
  );
}
