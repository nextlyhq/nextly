import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  type RemotePattern,
} from "@nextlyhq/blocks-engine";
import {
  definePlugin,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
} from "@nextlyhq/plugin-sdk";
import type { PreviewViewportsDeclaration } from "nextly/config";

// Imported rather than read at runtime so it can never drift from the published
// package: a hardcoded literal had fallen eight releases behind, and
// `validatePluginVersions` checks a contributor's `dependsOn` range against THIS
// value. A static JSON import is inlined by the bundler, so unlike a
// `createRequire` lookup it adds no Node builtin to this entry — which is
// isomorphic and reachable from a browser bundle.
import { version as PLUGIN_VERSION } from "../package.json";

import {
  BLOCK_SERVICE,
  createBlockRegistrationService,
  registerCoreBlocks,
  registerDeclaredBlocks,
} from "./blocks/registration-service";
import { registerClassUsageMaintenance } from "./class-usage-hook";
import {
  CLASS_USAGE_INDEX_SLUG,
  classUsageIndexCollection,
} from "./collections/class-usage-index";
import {
  COMPONENTS_SLUG,
  componentsCollection,
} from "./collections/components";
import { LAYOUTS_SLUG, layoutsCollection } from "./collections/layouts";
import type { PagesCollectionOptions } from "./collections/pages";
import { pagesCollection } from "./collections/pages";
import { PATTERNS_SLUG, patternsCollection } from "./collections/patterns";
import { blocksFieldType } from "./fields/blocksField";
import { hostFetchPolicy } from "./host-policy";
import { previewViewportsFromSiteStyle } from "./preview-viewports";
import { resolveSiteStyle, siteBreakpoints } from "./site-style";
import type { SiteStyleData } from "./site-style";
import { siteStyleSingle } from "./site-style-storage";

/**
 * What the plugin-owned `pages` collection is built with, resolved from the
 * host's options.
 *
 * Separated from the factory because it is a decision rather than an assembly
 * step: it is where "a page-builder site's default presets are its own
 * breakpoints" is stated, and reading it beside the collection list would
 * scatter that across the contribution block.
 */
function pagesOptions(
  opts: PageBuilderOptions,
  configStyle: SiteStyleData
): PagesCollectionOptions {
  return {
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
        const { getCachedNextly } = await import("nextly");
        const nextly = await getCachedNextly();
        return { findSingle: args => nextly.findSingle(args) };
      },
      ...(opts.siteStyle === undefined ? {} : { defaults: configStyle }),
    }),
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

export const pageBuilder = (opts: PageBuilderOptions = {}) => {
  // Resolved once, with no stored tier: at config time there is no database to
  // read, so what the factory can wire into the validator and the canvas is
  // the defaults tier. The stored tier reaches the published route through
  // `loadSiteStyle`, which reads per request.
  const configStyle = resolveSiteStyle(opts.siteStyle);

  return definePlugin({
    name: "@nextlyhq/plugin-page-builder",
    version: PLUGIN_VERSION,
    // The floor states the version carrying the APIs this plugin needs, not the
    // one it was first published against. Two of them: `blocks()` builds its
    // field with `pluginField`, and the editor reads its allowlist through
    // `usePluginClientConfig`, which the SDK re-exports from the admin package.
    // Against a core older than either, the import resolves to nothing and the
    // failure is a crash while the config is evaluated or the field mounts.
    //
    // Written from this package's OWN version rather than a literal, because
    // every published package here versions in lockstep: a plugin at version X
    // and a core at version X are always released together, so requiring a core
    // at least as new as this build is exactly the compatibility this needs. A
    // literal cannot say that. The APIs above land in the same release as the
    // plugin build that first calls them, and that version does not exist while
    // the change is being written — naming the next one guesses at a release
    // that has not happened, and leaves the source tree, where core carries the
    // CURRENT version, unable to satisfy its own plugin.
    nextly: `>=${PLUGIN_VERSION}`,
    // Identity metadata for the admin plugins page, mirroring package.json.
    author: "Nextly",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    category: "content",
    tags: ["page-builder", "blocks", "visual-editor"],
    enabled: opts.enabled,
    admin: {
      // How the plugin names itself wherever the admin lists it. Without this
      // the dashboard section and the plugins list fall back to `meta.name`,
      // which is the raw package specifier — `@nextlyhq/plugin-page-builder`
      // shown where the form builder shows "Forms". The icon matches the Pages
      // menu entry this plugin contributes, so one feature is not drawn two
      // different ways in the same sidebar.
      appearance: { icon: "Layout", label: "Page Builder" },
      description:
        "Build pages visually from blocks with drag-and-drop editing",
    },
    // Registers what other plugins DECLARED, and resolves the registry service
    // on the way, which is what empties it for the boot. The service is lazy:
    // on a boot where nothing contributes, nobody else resolves it and the
    // previous boot's blocks would survive. Doing it here makes the reset
    // unconditional, and cannot wipe a contributor whose `init` ran first,
    // because the factory is memoized for the boot and clears only on its
    // first resolution.
    init: ctx => {
      registerCoreBlocks(ctx);
      registerDeclaredBlocks(ctx);
      // Class-usage maintenance. Registered here rather than beside the
      // collection, because it is a property of the plugin being INSTALLED: the
      // index table exists whether or not anything maintains it, and a host
      // that installs the plugin is asking for both.
      registerClassUsageMaintenance({
        ctx,
        // The RESOLVED slug, not the declared one. An integrator may
        // `.rename({ nx_pb_class_usage: "..." })`, and the schema then creates
        // only the renamed collection — so a hook holding the literal would
        // write every row to a table that does not exist, and would also fail
        // to recognise its own writes and recurse.
        indexCollection:
          ctx.self.collections[CLASS_USAGE_INDEX_SLUG] ??
          CLASS_USAGE_INDEX_SLUG,
        // The registry record, projected. `getCollection` is declared to
        // return a shape that promises none of the properties this question
        // reads, while returning an object that carries all of them.
        draftSplit: (collection: unknown) =>
          resolvedCollectionDraftSplit(resolvedCollectionView(collection)),
        // Read per call, not captured: a host can reconfigure either, and a
        // value captured at install would keep deriving rows under bounds the
        // renderer no longer applies.
        locales: () =>
          ctx.config.localization?.locales.map(locale => locale.code) ?? [],
        // The SAME bounds the renderer draws under. Deriving the index under
        // different ones records a different document than the page serves:
        // raised bounds leave classes on the extra nodes unindexed, so a class
        // the page renders reads as unused.
        limits: () => opts.limits ?? DEFAULT_LIMITS,
      });
    },
    contributes: {
      // The channel another plugin adds blocks through. Core carries no
      // `contributes.blocks` key — a plugin contributing blocks is contributing
      // to the page builder, not to Nextly — so the registry is offered here and
      // reached via `ctx.services.plugins`.
      services: {
        [BLOCK_SERVICE]: () => createBlockRegistrationService(),
      },
      // The index is contributed unconditionally, alongside the pages it
      // describes. Its table existing is what lets the maintenance path write
      // to it without a first-run branch, exactly as the site style single is
      // registered whether or not the host stated any defaults.
      // The composition stores, contributed unconditionally beside the pages
      // they serve. Each is a collection rather than a shape inside one,
      // because a collection is what core seeds permissions for: the six
      // actions on `patterns` are separate rows from the six on `components`,
      // so "may create a pattern" and "may publish a component to every page
      // that carries it" are already different grants on the day this ships.
      // A single table discriminated by a column would leave both behind one
      // permission and could not declare a slug unique per kind.
      collections: [
        pagesCollection(pagesOptions(opts, configStyle)),
        patternsCollection(),
        componentsCollection(),
        layoutsCollection(),
        classUsageIndexCollection(),
      ],
      // The Site Style global: one versioned, access-controlled document the
      // stored style tier lives in. Registered whether or not the host stated
      // defaults, because the storage existing is what the style studios and
      // the API write against.
      // Given the SAME host list the published sheet, the canvas and the
      // inspector are given, through the same derivation: a named class is
      // emitted verbatim into every public page, so a `url()` stored here is a
      // request every visitor makes. `hostFetchPolicy` is the one place that
      // turns a pattern list into a predicate, so there is one answer to "may
      // this be fetched" rather than one per surface. A host that configured
      // no patterns gets today's behaviour: the engine treats an absent policy
      // as unasked.
      singles: [
        siteStyleSingle({
          ...hostFetchPolicy(opts.remotePatterns),
          // The CONFIG tier this site states in code, so the write gate judges
          // what consumers actually compile. Without it a stored class whose
          // slug a config class already holds is accepted and then dropped at
          // render, and the node referencing it gets no rule at all.
          ...(opts.siteStyle === undefined ? {} : { defaults: configStyle }),
        }),
      ],
      // One field type, where there were two. The other named the previous
      // editor's document — a shape this package defined itself, stored under a
      // synthetic root, and validated with its own rules. A site that declared
      // it got a field the engine could not read and the current renderer could
      // not draw, so the two field types were not alternatives but rival
      // formats, and only this one is a format anything else understands.
      // Built against the configured breakpoints, so a document write is
      // validated against the same set the canvas draws with. With none
      // configured this is the empty set, which the engine treats permissively.
      fieldTypes: [blocksFieldType(siteBreakpoints(configStyle))],
      // No `publish` permission. One was declared here and nothing ever read
      // it: publishing a page is a status change on the entry, which
      // `update-pages` already covers, and no code path asked whether the user
      // could publish. Granting it did nothing and withholding it prevented
      // nothing. Declare it again alongside the check that reads it.
      //
      // The permission below is read by the `customCss` field rule in
      // `pagesCollection()`, so granting and withholding it each change what a
      // user can do.
      admin: {
        // The canvas needs the allowlist and runs in the browser, so it
        // travels with the rest of the admin metadata. `remotePatterns` is
        // plain data and survives the trip; the serializer rejects it if a
        // future addition here does not.
        // Sent only when the host said something. An always-present
        // `clientConfig` would make every future reader distinguish "the host
        // set this" from "the default is showing", which is what the absent
        // key already says.
        ...(opts.remotePatterns !== undefined ||
        opts.checklist !== undefined ||
        opts.limits !== undefined ||
        opts.siteStyle !== undefined
          ? {
              clientConfig: {
                ...(opts.remotePatterns === undefined
                  ? {}
                  : { remotePatterns: opts.remotePatterns }),
                ...(opts.checklist === undefined
                  ? {}
                  : { checklist: opts.checklist }),
                // The RESOLVED defaults tier rather than the raw option, so
                // the canvas and the validator read one answer. Plain data:
                // tokens, fonts, classes and breakpoints all serialize, and
                // none of it is secret — a published page emits it as CSS.
                ...(opts.siteStyle === undefined
                  ? {}
                  : { siteStyle: configStyle }),
                /*
                 * The bounds the renderer draws under, so the admin asks the
                 * same question the page answers. The classes manager walks the
                 * open document to say which classes a page applies, and a walk
                 * under different limits selects different nodes — reporting a
                 * class as absent from a page that renders it. Plain numbers,
                 * and nothing secret: the published page is drawn under them.
                 */
                ...(opts.limits === undefined
                  ? {}
                  : { limits: jsonSafeLimits(opts.limits) }),
              },
            }
          : {}),
        // Each entry names the permission that makes its screen reachable, so
        // a role without it is not offered a link into a list it would be
        // refused. Pages carries none for the same reason it always has: it is
        // the plugin's front door, and a reader who cannot read pages has
        // nothing to do here at all.
        //
        // They sit beside Pages rather than under a section of their own. The
        // sidebar's section vocabulary is a closed list in core with no design
        // entry, so grouping them would mean widening that list — a change to
        // the admin's navigation model, which is a larger question than where
        // three links go.
        menu: [
          { label: "Pages", to: "/admin/collections/pages", icon: "Layout" },
          {
            label: "Patterns",
            to: `/admin/collections/${PATTERNS_SLUG}`,
            icon: "LayoutTemplate",
            requiredPermission: `read-${PATTERNS_SLUG}`,
          },
          {
            label: "Components",
            to: `/admin/collections/${COMPONENTS_SLUG}`,
            icon: "Component",
            requiredPermission: `read-${COMPONENTS_SLUG}`,
          },
          {
            label: "Layouts",
            to: `/admin/collections/${LAYOUTS_SLUG}`,
            icon: "PanelsTopLeft",
            requiredPermission: `read-${LAYOUTS_SLUG}`,
          },
        ],
        // No `schemaBuilderSlot` and no `entryFormToolbarSlot`.
        //
        // Both named components this package no longer ships: a schema-builder
        // toggle for turning a collection into a page-builder one, and a
        // per-entry Normal / Page Builder switch. They belonged to an editor
        // that stored its own document format, so the choice they offered was
        // between two storage shapes rather than between two ways of editing
        // one.
        //
        // A slot is registered by SPECIFIER, so nothing type-checks the name:
        // pointing at a component that is not exported resolves to nothing at
        // render time, in the admin, at the moment an author opens the form.
        // Declaring them is therefore worse than omitting them — the admin
        // reserves the slot either way and only the populated case works.
      },
    },
  });
};
