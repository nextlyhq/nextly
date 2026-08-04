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
  registerDeclaredBlocks,
} from "./blocks/registration-service";
import { PAGE_BUILDER_FIELD_TYPE } from "./collections/pageBuilderEntry";
import { pagesCollection } from "./collections/pages";
import type { RemotePattern } from "./core/url-policy";
import { BLOCKS_FIELD_TYPE } from "./fields/blocksField";

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
   * Set the SAME value on `PageRenderer.remotePatterns`. These are two
   * assignments, not one: this configures the editor, and `PageRenderer` reads
   * only its own prop. Setting one alone produces a mismatch in whichever
   * direction you set it, so a shared constant in the host is what keeps them
   * equal.
   *
   * Object patterns only, unlike `PageRenderer`, which also accepts a `URL`.
   * This value is serialized to the browser and a `URL` does not survive that:
   * it would arrive as a string. Converting one here would mean deciding what
   * its default `pathname` of `"/"` means as a glob, and guessing at that in a
   * security control is worse than declining the input.
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
    // field with `pluginField`, which core first exports in alpha.49 — against
    // an earlier core that import resolves to `undefined` and every `blocks()`
    // call throws while the config is evaluated. And `contributes.admin.
    // clientConfig` is the transport `remotePatterns` reaches the editor
    // through, added in alpha.52; an older core validates the plugin happily
    // and simply does not serialize the field, so the canvas would keep the
    // empty allowlist this exists to fix, with nothing to say why.
    nextly: ">=0.0.2-alpha.52",
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
