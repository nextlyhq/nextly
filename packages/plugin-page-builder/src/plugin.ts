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
import { PAGE_BUILDER_FIELD_TYPE } from "./collections/pageBuilderEntry";
import { pagesCollection } from "./collections/pages";
import type { RemotePattern } from "./core/url-policy";
import { BLOCKS_FIELD_TYPE } from "./fields/blocksField";
import { CUSTOM_CSS_ACTION, CUSTOM_CSS_RESOURCE } from "./permissions";

export interface PageBuilderOptions {
  /** Disable behavior while still applying schema. Default true. */
  enabled?: boolean;
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
   * **Not `@nextlyhq/blocks-react`**, which has no way to bound what a page
   * fetches. Its checks are about schemes: the engine's CSS compiler limits an
   * EXPLICIT scheme to `http`/`https` and leaves a scheme-less value alone, so
   * `//cdn.example/a.png` passes; a block's attribute props reject
   * `javascript:`, `vbscript:` and `data:` and admit every other scheme. It does
   * compare hosts in one place — `hostPolicy.trustedFrameOrigins` decides
   * whether an embed keeps its own origin — but that governs a sandbox
   * permission, not whether the frame is loaded.
   *
   * Object patterns only. This value is serialized to the browser and a `URL`
   * does not survive that: it would arrive as a string. Converting one here
   * would mean deciding what its default `pathname` of `"/"` means as a glob,
   * and guessing at that in a security control is worse than declining the
   * input.
   */
  remotePatterns?: readonly RemotePattern[];
}

/**
 * The Page Builder plugin factory. Call it in a host app's
 * `defineConfig({ plugins: [pageBuilder()] })`.
 */
export const pageBuilder = (opts: PageBuilderOptions = {}) =>
  definePlugin({
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
      fieldTypes: [PAGE_BUILDER_FIELD_TYPE, BLOCKS_FIELD_TYPE],
      // No `publish` permission. One was declared here and nothing ever read
      // it: publishing a page is a status change on the entry, which
      // `update-pages` already covers, and no code path asked whether the user
      // could publish. Granting it did nothing and withholding it prevented
      // nothing. Declare it again alongside the check that reads it.
      //
      // The permission below is read by the `customCss` field rule in
      // `pagesCollection()`, so granting and withholding it each change what a
      // user can do.
      permissions: [
        {
          action: CUSTOM_CSS_ACTION,
          resource: CUSTOM_CSS_RESOURCE,
          label: "Write custom CSS",
          description:
            "Author per-page and per-block custom CSS in the page builder. Without it the CSS already on a page stays visible and applied, but cannot be changed.",
          // No `group`: the admin files this under the plugin that declared it,
          // and one permission does not need sorting into headings.
          //
          // `danger` because it is author-written CSS that reaches the
          // published page. A site that declared `remotePatterns` for its
          // images declared them for this too, and a selector can make such a
          // request conditional on what a page contains.
          danger: true,
        },
      ],
      admin: {
        // The canvas needs the allowlist and runs in the browser, so it
        // travels with the rest of the admin metadata. `remotePatterns` is
        // plain data and survives the trip; the serializer rejects it if a
        // future addition here does not.
        ...(opts.remotePatterns !== undefined
          ? {
              clientConfig: { remotePatterns: opts.remotePatterns },
            }
          : {}),
        menu: [
          { label: "Pages", to: "/admin/collections/pages", icon: "Layout" },
        ],
        // Schema-builder "Use Page Builder" toggle, rendered generically by the
        // admin above the field list in the collection/single builders.
        schemaBuilderSlot:
          "@nextlyhq/plugin-page-builder/admin#PageBuilderToggle",
        // Per-entry Normal / Page Builder toggle, rendered in the entry/single
        // form header toolbar (drives the hidden editor-mode field).
        entryFormToolbarSlot:
          "@nextlyhq/plugin-page-builder/admin#PageBuilderModeToggle",
      },
    },
  });
