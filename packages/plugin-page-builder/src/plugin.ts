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
} from "./blocks/registration-service";
import { PAGE_BUILDER_FIELD_TYPE } from "./collections/pageBuilderEntry";
import { pagesCollection } from "./collections/pages";
import { BLOCKS_FIELD_TYPE } from "./fields/blocksField";

export interface PageBuilderOptions {
  /** Disable behavior while still applying schema. Default true. */
  enabled?: boolean;
}

/**
 * The Page Builder plugin factory. Call it in a host app's
 * `defineConfig({ plugins: [pageBuilder()] })`.
 */
export const pageBuilder = (opts: PageBuilderOptions = {}) =>
  definePlugin({
    name: "@nextlyhq/plugin-page-builder",
    version: PLUGIN_VERSION,
    // `blocks()` builds its field with `pluginField`, which core first exports
    // in alpha.49. Against an earlier core that import resolves to `undefined`
    // and every `blocks()` call throws while the config is evaluated, so the
    // floor states the version carrying the API rather than the one this plugin
    // was first published against.
    nextly: ">=0.0.2-alpha.49",
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
