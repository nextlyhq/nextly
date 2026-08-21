import { isFetchableUrl, type RemotePattern } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";

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
import { pagesCollection } from "./collections/pages";
import { blocksFieldType } from "./fields/blocksField";
import { resolveSiteStyle, siteBreakpoints } from "./site-style";
import type { SiteStyleData } from "./site-style";
import { siteStyleSingle } from "./site-style-storage";

export interface PageBuilderOptions {
  /** Disable behavior while still applying schema. Default true. */
  enabled?: boolean;
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
}

/**
 * The host-fetch policy the Site Style write gate judges stored classes by.
 *
 * Derived from the SAME `remotePatterns` list the published page and the
 * canvas are given, through `isFetchableUrl` — the engine's matcher, which
 * this package re-exports. One implementation of "may this be fetched" is the
 * point: a class refused on the canvas and served from the site sheet is the
 * disagreement a second matcher would produce.
 *
 * No patterns means no policy rather than an empty allowlist, because the two
 * are opposite answers. An empty list refuses every remote URL, which would
 * break every site that has not configured one; absent leaves the engine's
 * scheme allowlist as the only limit, which is what those sites have today.
 */
function siteStyleWritePolicy(patterns: readonly RemotePattern[] | undefined): {
  mayFetchUrl?: (url: string) => boolean;
} {
  if (patterns === undefined) return {};
  return { mayFetchUrl: (url: string) => isFetchableUrl(url, patterns) };
}

/**
 * The Page Builder plugin factory. Call it in a host app's
 * `defineConfig({ plugins: [pageBuilder()] })`.
 */
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
    },
    contributes: {
      // The channel another plugin adds blocks through. Core carries no
      // `contributes.blocks` key — a plugin contributing blocks is contributing
      // to the page builder, not to Nextly — so the registry is offered here and
      // reached via `ctx.services.plugins`.
      services: {
        [BLOCK_SERVICE]: () => createBlockRegistrationService(),
      },
      collections: [pagesCollection()],
      // The Site Style global: one versioned, access-controlled document the
      // stored style tier lives in. Registered whether or not the host stated
      // defaults, because the storage existing is what the style studios and
      // the API write against.
      // Given the SAME host list the published sheet and the canvas are given,
      // through the same predicate: a named class is emitted verbatim into
      // every public page, so a `url()` stored here is a request every visitor
      // makes. `isFetchableUrl` is the engine's, re-exported by this package's
      // url-policy module, so there is one answer to "may this be fetched"
      // rather than one per surface. A host that configured no patterns gets
      // today's behaviour: the engine treats an absent policy as unasked.
      singles: [siteStyleSingle(siteStyleWritePolicy(opts.remotePatterns))],
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
              },
            }
          : {}),
        menu: [
          { label: "Pages", to: "/admin/collections/pages", icon: "Layout" },
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
