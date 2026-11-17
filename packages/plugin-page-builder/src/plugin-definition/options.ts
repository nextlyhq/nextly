/**
 * The Page Builder's options and what is worked out from them alone: the
 * `PageBuilderOptions` a host passes to `pageBuilder()`, the pages
 * collection's preview settings, where component definitions live, the code
 * tier of the site style, the font catalogue's parts, and what the editor in
 * the browser is sent as the admin's `clientConfig`.
 */
import {
  DEFAULT_LIMITS,
  type AnyBlockDefinition,
  type DocumentLimits,
  type NamedQueryDefinition,
  type RemotePattern,
} from "@nextlyhq/blocks-engine";
import { COMPONENT_DOCUMENT_FIELD } from "@nextlyhq/blocks-react";
import type { PluginCollectionView } from "@nextlyhq/plugin-sdk";
import type { PreviewViewportsDeclaration } from "nextly/config";

import { DELETE_COMPONENT_REPLACEMENT_COMPONENT } from "../builder-view";
import { COMPONENTS_SLUG } from "../collections/components";
import type { PagesCollectionOptions } from "../collections/pages";
import { withRegisteredLooks } from "../core-looks";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "../library-route";
import { previewViewportsFromSiteStyle } from "../preview-viewports";
import type { PublishReadinessSetup } from "../publish-readiness";
import type { PageBuilderSiteCodeOptions } from "../site-code/route";
import type {
  PageBuilderFontOptions,
  resolveFontOptions,
} from "../site-fonts/options";
import { siteFontRoutes } from "../site-fonts/routes";
import { resolveSiteStyle, type SiteStyleData } from "../site-style";
import type { PageBuilderTemplateOptions } from "../templates/template-addresses";

/**
 * What the plugin-owned `pages` collection is built with, resolved from the
 * host's options.
 *
 * Separated from the factory because it is a decision rather than an assembly
 * step: it is where "a page-builder site's default presets are its own
 * breakpoints" is stated, and reading it beside the collection list would
 * scatter that across the contribution block.
 */
export function pagesOptions(
  opts: PageBuilderOptions,
  configStyle: SiteStyleData,
  validateLayout: PagesCollectionOptions["validateLayout"]
): PagesCollectionOptions {
  return {
    ...(validateLayout === undefined ? {} : { validateLayout }),
    ...(opts.pagePreviewPath === undefined
      ? {}
      : { previewPath: opts.pagePreviewPath }),
    ...(pagePreviewBreakpoints(opts, configStyle) ?? {}),
  };
}

/**
 * The viewport declaration the pages preview carries, or nothing.
 *
 * Answers with a whole `{ breakpoints }` fragment rather than a value, so the
 * "offer none" case is an ABSENT key instead of an explicit `undefined`:
 * `resolvePreviewViewports` reads an absent declaration as "offer nothing", and
 * the pane then falls back to Responsive and a custom width.
 */
function pagePreviewBreakpoints(
  opts: PageBuilderOptions,
  configStyle: SiteStyleData
): { breakpoints: PreviewViewportsDeclaration } | undefined {
  if (opts.pagePreviewBreakpoints === false) return undefined;
  if (opts.pagePreviewBreakpoints !== undefined) {
    return { breakpoints: opts.pagePreviewBreakpoints };
  }

  /*
   * The default, and the reason this option exists at all: a page-builder
   * site's breakpoints ARE the widths its stylesheet changes at, so they are
   * the only widths a preset can name without making a claim about somebody
   * else's CSS.
   *
   * Read per mint rather than captured here, because an author edits them in
   * the page builder — a list read once at construction would size the frame to
   * a tier the site no longer has.
   */
  return {
    breakpoints: previewViewportsFromSiteStyle({
      /*
       * Imported at call time, not at module scope. This runs per mint on the
       * server, and a static import would pull the Direct API graph into every
       * consumer of this plugin — including the browser bundle the canvas ships
       * in, which has no use for it and cannot run it.
       */
      reader: async () => {
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const nextly = await getCachedNextly();
        return { findSingle: args => nextly.findSingle(args) };
      },
      // The code tier, which always holds the core blocks' looks.
      defaults: configStyle,
    }),
  };
}

/**
 * Where the plugin was told component definitions live, for every reader.
 *
 * ONE derivation, handed to the editor's library route and to the readiness
 * notice alike, so a host that keeps its definitions in a collection of its
 * own says so once and both follow. Turned-off readiness says nothing about
 * the store, so the editor reads the plugin's own — the honest default for a
 * host whose definitions come from no collection at all, which no collection
 * read can follow.
 */
export function componentStoreOf(opts: PageBuilderOptions): ComponentStore {
  const readiness = opts.componentReadiness;
  if (readiness === false || readiness === undefined) {
    return DEFAULT_COMPONENT_STORE;
  }
  return {
    ...(readiness.collection === undefined
      ? {}
      : { collection: readiness.collection }),
    field: readiness.field ?? COMPONENT_DOCUMENT_FIELD,
  };
}

/**
 * Whether the plugin's own Components collection is the component store: no
 * host store is named, or the one named is it.
 */
export function storeIsOwn(store: ComponentStore): boolean {
  return store.collection === undefined || store.collection === COMPONENTS_SLUG;
}

/**
 * The admin views that route a component's delete through Delete component,
 * on the store's collection and no other: the plugin's own when no host store
 * is named, else the host's.
 */
export function deleteComponentViews(
  store: ComponentStore
): Record<string, PluginCollectionView> {
  const replaced = {
    documentActions: {
      delete: {
        component: DELETE_COMPONENT_REPLACEMENT_COMPONENT,
        label: "Delete component…",
      },
    },
  };
  return store.collection === undefined || storeIsOwn(store)
    ? { [COMPONENTS_SLUG]: replaced }
    : { [store.collection]: replaced };
}

/**
 * Refuse a component store that shares a slug with a collection this plugin
 * declares, other than naming its own Components collection.
 *
 * The delete's surfaces are keyed by the store's slug, and a key that is one
 * of the plugin's own slugs is read as that plugin collection, through any
 * rename: a host store named `patterns` would get Delete component on the
 * plugin's Patterns, and one named `components` while the plugin's own is
 * renamed would get it on the renamed collection, while the delete itself
 * acts on the host's. Ambiguous either way, so refused, naming both, rather
 * than guessed. `resolved` is the plugin's collections as the site renamed
 * them, known from `init`; without it, only the declared names are judged.
 */
export function refuseStoreSharingAPluginSlug(
  store: ComponentStore,
  declared: readonly string[],
  resolved?: Readonly<Record<string, string | undefined>>
): void {
  const slug = store.collection;
  if (slug === undefined) return;
  if (slug === COMPONENTS_SLUG) {
    const renamed = resolved?.[COMPONENTS_SLUG] ?? COMPONENTS_SLUG;
    if (renamed === COMPONENTS_SLUG) return;
    throw new Error(
      `[page-builder] componentReadiness.collection names "${slug}", but the Page Builder's own Components collection is renamed to "${renamed}". Leave componentReadiness.collection unset to keep components in the plugin's collection, or give the host's store a slug the Page Builder does not declare.`
    );
  }
  if (declared.includes(slug)) {
    throw new Error(
      `[page-builder] componentReadiness.collection names "${slug}", which is also a collection the Page Builder declares. A component store of the host's own needs a slug of its own: rename the host's collection, or leave componentReadiness.collection unset to use the plugin's Components collection.`
    );
  }
}

/**
 * A host's own component store's slug, or `undefined` when the store is the
 * plugin's own collection.
 */
export function hostStoreOf(store: ComponentStore): string | undefined {
  return store.collection === undefined || storeIsOwn(store)
    ? undefined
    : store.collection;
}

/** What the publish-readiness routes read, from the same options the notice does. */
export function publishReadinessSetup(
  opts: PageBuilderOptions
): PublishReadinessSetup {
  return {
    store: componentStoreOf(opts),
    enabled: opts.componentReadiness !== false,
    limits: () => opts.limits ?? DEFAULT_LIMITS,
  };
}

export interface PageBuilderOptions {
  /** Disable behavior while still applying schema. Default true. */
  enabled?: boolean;
  /**
   * The document limits pages are rendered under, when they are not the
   * engine's defaults.
   *
   * Set the SAME value here and on `PageRenderer.limits` (or on the style
   * context it reads). The renderer decides which nodes a page draws; this
   * decides which nodes the class-usage index counts, and both ask the engine
   * the same question through `selectNodes`. Handing them different bounds
   * makes them answer about different documents — a class applied to a node the
   * page renders would be missing from the index, and a usage-based delete
   * reads that absence as "not used".
   *
   * Left unset, both use the engine defaults and agree by construction.
   */
  limits?: DocumentLimits;
  /**
   * The site's named queries: a collection list's custom sources, made with
   * `defineNamedQuery` from `@nextlyhq/plugin-sdk/blocks`. Registered on each
   * boot beside the ones plugins declare, all or nothing.
   *
   * @experimental
   */
  namedQueries?: readonly NamedQueryDefinition[];
  /**
   * Where component definitions live: what publishing a page checks when it
   * warns that some are not live, and what the EDITOR reads to draw them.
   *
   * Defaults to the component store this plugin contributes, which is where the
   * renderer reads them from unless a route says otherwise. A route MAY say
   * otherwise: `createBlocksPage` accepts `componentCollection` to name a
   * different store and `resolveComponents` to supply definitions from
   * somewhere that is not a collection at all. Neither is visible from here —
   * the route is configured in the host's app — so a host that redirected the
   * renderer must redirect this too, or the notice judges the page against a
   * store it does not render from and reports live components as missing, and
   * the editor draws a different definition for the same id than the page
   * does, or none. Naming `collection` and `field` here redirects both at once.
   *
   * `false` turns the notice off, which is the honest setting for a host whose
   * definitions come from a custom `resolveComponents` source: no collection
   * can answer the question, so asking one produces a warning about nothing.
   * The editor then reads the plugin's own store, the one thing it can read.
   */
  componentReadiness?:
    | false
    | {
        collection?: string;
        field?: string;
        pageField?: string;
        /**
         * The collections a route renders. Unset, every collection with a
         * blocks field is examined; named, the notice stays quiet about
         * content no route serves, since claiming components "will not appear
         * for visitors" is a claim about a page that does not exist.
         */
        renderedCollections?: readonly string[];
      };
  /**
   * Whether the editor shows its getting-started checklist. Default true.
   *
   * A site that teaches its authors the editor some other way turns it off
   * here rather than asking every one of them to dismiss it. Travels to the
   * browser through `clientConfig` for the same reason `remotePatterns` does:
   * the canvas runs there, where a server-side option cannot reach it.
   */
  checklist?: boolean;
  /**
   * Remote hosts a page may load images, video and embeds from, in the same
   * shape `next/image` uses.
   *
   * The editor canvas renders the same blocks the published page does, so it
   * has to enforce the same allowlist — otherwise it hides media the live page
   * shows, and the preview stops being a preview. Declared here rather than
   * only on `PageRenderer` because the canvas runs in the browser, where a
   * component prop from the host's server config cannot reach it.
   *
   * Set the SAME value on `PageRenderer.remotePatterns` from
   * `@nextlyhq/plugin-page-builder/render`, and pass it to `cspDirectives()` or
   * `cspHeaderValue()`. Three assignments: each surface reads only what it was
   * handed, and the CSP helpers default to an empty list.
   *
   * Even then the three are not identical. CSP cannot express a `pathname` or
   * `search` constraint, so `cspDirectives()` omits such a host rather than
   * widening the policy to its whole origin; `unexpressibleHosts()` reports what
   * it refused so the host can write that source itself.
   *
   * **Enforced for** the built-in block renderers and structured style values,
   * through `isFetchableUrl`; the embed HTML sanitizer; the editor canvas. A
   * CUSTOM block is handed the patterns and must apply them itself — `RenderNode`
   * passes them in and cannot inspect the element a block returns.
   *
   * **Not custom CSS.** `sanitizeCustomCss` takes no patterns and drops every
   * url naming a host, whether by scheme — including `https://site.example/a.png`,
   * the site's own origin, since compilation has no document origin to compare
   * against — or by the scheme-less `//cdn.example/a.png`. What survives is a
   * path naming no host: `/a.png`, `a.png`. That is a property of the stored
   * TEXT, not of the eventual request — a cross-origin `<base href>` on the
   * host document re-points every such path at another origin, which is a
   * surface a parser cannot reach and one reason `cspDirectives()` emits
   * `base-uri`. That surface is stricter than this value, not governed by it.
   *
   * **Also `@nextlyhq/blocks-react`**, which now bounds what a published page
   * fetches — but only when it is TOLD to, and from its own field. Pass the same
   * list as `hostPolicy={{ remotePatterns }}` on its `PageRenderer`, or as
   * `hostPolicy` in `createBlocksPage({ ... })`. Leaving it unset while this is
   * configured means the editor and the published page enforce different rules,
   * which is the failure this note exists to prevent: the canvas refuses a host
   * the live page then loads.
   *
   * That covers the three ways the published page reaches out — a block's own
   * markup, the compiled stylesheet, and the link-preview image in metadata.
   * The renderer's remaining checks are about SCHEMES and stay narrower than a
   * host rule: the engine's CSS compiler limits an explicit scheme to
   * `http`/`https` and leaves a scheme-less value alone, so `//cdn.example/a.png`
   * passes the scheme check and is judged by the host list instead; a block's
   * attribute props admit `http`, `https`, `mailto` and `tel` and refuse every
   * other scheme.
   *
   * A CUSTOM block written against `blocks-react` is bounded only if it asks,
   * for the same reason as above: the boundary sees the element a block returned
   * and not the URLs it chose. `hostPolicy.trustedFrameOrigins` remains a
   * separate question — it decides whether an embed keeps its own origin, which
   * is a sandbox permission rather than whether the frame is loaded.
   *
   * Object patterns only. This value is serialized to the browser and a `URL`
   * does not survive that: it would arrive as a string. Converting one here
   * would mean deciding what its default `pathname` of `"/"` means as a glob,
   * and guessing at that in a security control is worse than declining the
   * input.
   */
  remotePatterns?: readonly RemotePattern[];
  /**
   * The site's style DEFAULTS: tokens, fonts, named classes and breakpoints
   * stated in code. The stored Site Style document layers over these —
   * `resolveSiteStyle` in `site-style` is the one merge — so a site whose
   * design lives in the repository states it here, and an admin's saved edit
   * overrides exactly what it names and nothing else.
   *
   * Feeds two surfaces from one statement: the blocks field's server-side
   * validator judges documents against these breakpoints, and the editor
   * canvas compiles its preview sheet from the whole set (it travels through
   * `clientConfig`, so it must hold nothing secret — it is emitted into the
   * CSS of every public page anyway).
   *
   * A published route states the same value once more, on `loadSiteStyle`'s
   * `defaults`, for the same reason `remotePatterns` appears on more than one
   * surface: the route helper runs where this option cannot reach it. Define
   * the object once and hand it to both.
   */
  siteStyle?: SiteStyleData;

  /**
   * Where this application serves its pages, as a path with `{field}`
   * placeholders — `"/{slug}"` for a blocks page at the site root,
   * `"/blocks/{slug}"` for one mounted under a prefix.
   *
   * **Setting this is what enables shareable preview links for pages**, and
   * there is deliberately no default. The plugin cannot install the host's
   * preview route or its draft gate, and cannot discover where pages are
   * mounted — so a defaulted path would let an editor mint a link that resolves
   * to nothing, while declaring nothing gets them an explanation instead.
   */
  pagePreviewPath?: string;

  /**
   * Where this application serves the editor's canvas route: the path of a
   * route whose page is `PageBuilderCanvas` from
   * `@nextlyhq/plugin-page-builder/canvas`, inside the layouts the site's
   * pages are published in.
   *
   * **Setting this is what draws the canvas inside the site's own layout**, so
   * its global stylesheets, fonts, header and footer show around the page
   * being edited exactly as they do around the published page. There is no
   * default, for the reason `pagePreviewPath` has none: the plugin cannot add
   * a route to the application, and a defaulted path would load a page that is
   * not there. Without it, the canvas draws on a blank page of the editor's own
   * and says so.
   *
   * A path on this site only, such as `"/page-builder-canvas"`: the editor
   * draws into the frame's document, which a browser allows on its own origin
   * alone.
   *
   * A site whose pages sit under their language writes `{locale}` where the
   * code goes, as in `"/{locale}/page-builder-canvas"`: the editor loads the
   * route for the language being edited, and for the default language leaves
   * the segment out, as most localized sites serve it.
   */
  canvasPath?: string;

  /**
   * The viewport widths the pages preview offers.
   *
   * Defaults to **this site's own breakpoints**, read from the `site-style`
   * single at the moment a preview link is minted. That default is the whole
   * point: a page-builder site's breakpoints ARE the widths its stylesheet
   * changes at, so they are the only widths a preset can name without making a
   * claim about somebody else's CSS — and requiring every host to wire that up
   * by hand would leave the feature switched off for the workflow it was built
   * for.
   *
   * Read per mint rather than captured here, because an author edits those
   * breakpoints in the page builder: a list read once at boot would size the
   * frame to a tier the site no longer has.
   *
   * Pass a list or a function of your own to override it, or `false` to offer
   * none — the pane then falls back to Responsive and a custom width, which is
   * everything it can offer honestly without inventing numbers.
   *
   * Ignored without a `pagePreviewPath`: there is no preview to offer them on.
   */
  pagePreviewBreakpoints?: PreviewViewportsDeclaration | false;

  /**
   * Catalogue fonts in Design → Fonts. Adding one makes the SERVER download
   * its files from the catalogue into the site's media, so published pages
   * load fonts only from the site. The server reaches the two catalogue hosts
   * (declared as this plugin's outbound hosts) and nothing else. `{ catalogue:
   * false }` turns the catalogue off; uploading a font file still works.
   */
  fonts?: PageBuilderFontOptions;

  /**
   * Site code: the code people who may change the site's settings add to
   * every published page, in Settings, under Site. Declare the site's
   * Content Security Policy here (`csp`, a header value or a function read on
   * each check) so code is checked against it before it is saved.
   *
   * @experimental
   */
  siteCode?: PageBuilderSiteCodeOptions;

  /**
   * Collection templates: where each collection defined in code serves its
   * entries, drawn with the collection's published template.
   *
   * ```ts
   * pageBuilder({ templates: { addresses: { posts: "/blog" } } });
   * ```
   *
   * serves each published post at `/blog/<its slug>` from the site's content
   * route (`createContentPage` with `pageBuilderContent()`), once the
   * collection's template is published. An address not in its one spelling,
   * or under a path the runtime keeps, refuses to start; so do two
   * collections given one address, and a collection that cannot have a
   * template.
   *
   * @experimental New public surface: its name and shape may change before
   * it is marked stable.
   */
  templates?: PageBuilderTemplateOptions;
}

/**
 * The code tier refreshed with every registered block's looks, other
 * plugins' among them, once they have all registered at init. Updated in
 * place: every reader holds this one object and this one set, and none has
 * read them yet. The looks come from the function the canvas and the
 * published page's site style take theirs from, so the three agree.
 */
export function refreshCodeTier(
  configStyle: SiteStyleData,
  configClassIds: Set<string>,
  siteStyle: SiteStyleData | undefined,
  registered: readonly AnyBlockDefinition[]
): void {
  configStyle.classes = resolveSiteStyle(
    withRegisteredLooks(siteStyle, registered)
  ).classes;
  configClassIds.clear();
  for (const entry of configStyle.classes ?? []) configClassIds.add(entry.id);
}

/**
 * What the plugin publishes to the editor in the browser, as the admin's
 * `clientConfig`, or nothing when the host stated none of it.
 *
 * The canvas runs in the browser, where a server-side option cannot reach it,
 * so what it needs travels with the rest of the admin metadata: the media
 * allowlist, the checklist, the canvas route, the site style, the document
 * limits and whether there is a font catalogue. All of it is plain data that
 * survives the trip, and the serializer rejects a future addition that does
 * not.
 *
 * Sent only when the host said something. An always-present `clientConfig`
 * would make every future reader distinguish "the host set this" from "the
 * default is showing", which is what the absent key already says. Each key is
 * written only where the host stated it, so a config with no key is one the
 * host said nothing in.
 */
export function adminClientConfig(
  opts: PageBuilderOptions,
  {
    configStyle,
    canvasPath,
    fontsOff,
  }: {
    configStyle: SiteStyleData;
    canvasPath: string | undefined;
    fontsOff: boolean;
  }
): { clientConfig?: Record<string, unknown> } {
  const clientConfig: Record<string, unknown> = {
    // The Fonts tab offers no catalogue when the host turned it off, rather
    // than one whose routes do not exist.
    ...(fontsOff ? { fontCatalogue: false } : {}),
    ...(opts.remotePatterns === undefined
      ? {}
      : { remotePatterns: opts.remotePatterns }),
    ...(opts.checklist === undefined ? {} : { checklist: opts.checklist }),
    // A host's own component store, by slug, for the delete tools the header
    // draws for its list. A slug, nothing secret.
    ...(hostStoreOf(componentStoreOf(opts)) === undefined
      ? {}
      : { componentStore: hostStoreOf(componentStoreOf(opts)) }),
    // The canvas route's path, which the editor loads its frame from. A path,
    // never a secret: the route serves an empty page.
    ...(canvasPath === undefined ? {} : { canvasPath }),
    // The RESOLVED defaults tier rather than the raw option, so the canvas and
    // the validator read one answer. Plain data: tokens, fonts, classes and
    // breakpoints all serialize, and none of it is secret — a published page
    // emits it as CSS.
    // Always stated: the code tier holds the core blocks' looks even when the
    // host states no site style of its own.
    siteStyle: configStyle,
    /*
     * The bounds the renderer draws under, so the admin asks the same question
     * the page answers. The classes manager walks the open document to say
     * which classes a page applies, and a walk under different limits selects
     * different nodes — reporting a class as absent from a page that renders
     * it. Plain numbers, and nothing secret: the published page is drawn under
     * them.
     */
    ...(opts.limits === undefined
      ? {}
      : { limits: jsonSafeLimits(opts.limits) }),
  };
  return Object.keys(clientConfig).length === 0 ? {} : { clientConfig };
}

/**
 * The Page Builder plugin factory. Call it in a host app's
 * `defineConfig({ plugins: [pageBuilder()] })`.
 */
/**
 * Document limits in a form that survives the client-config round trip.
 *
 * `clientConfig` is refused at BOOT unless it is delivered unchanged through
 * JSON, and `Infinity` is not a JSON value — it round-trips to `null`, so
 * publishing it raw takes the whole plugin down. An infinite bound is
 * deliberately supported by the engine, whose byte measurement refuses to
 * reject one, so it has to be carried rather than dropped.
 *
 * `null` is the wire spelling for "no bound", and the admin reads it back as
 * `Infinity`. Encoded here because this is where the value crosses into JSON.
 */
function jsonSafeLimits(limits: DocumentLimits): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(limits).map(([key, value]) => [
      key,
      Number.isFinite(value) ? value : null,
    ])
  );
}

/**
 * What the font catalogue adds to the plugin: the two hosts its server may
 * reach, its routes, and whether the host turned it off. Worked out once, so
 * the plugin's definition spreads the parts rather than asking at each.
 */
export function fontCatalogueParts(
  fonts: ReturnType<typeof resolveFontOptions>
): {
  off: boolean;
  capabilities: { capabilities?: { net: { outbound: string[] } } };
  routes: ReturnType<typeof siteFontRoutes>;
} {
  if (fonts === false) return { off: true, capabilities: {}, routes: [] };
  return {
    off: false,
    capabilities: { capabilities: { net: { outbound: [...fonts.outbound] } } },
    routes: siteFontRoutes({ fonts }),
  };
}
