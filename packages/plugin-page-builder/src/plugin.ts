import { definePlugin } from "@nextlyhq/plugin-sdk";

import { PAGE_BUILDER_FIELD_TYPE } from "./collections/pageBuilderEntry";
import { pagesCollection } from "./collections/pages";

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
    version: "0.0.2-alpha.29",
    nextly: ">=0.0.2-alpha.21",
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
      collections: [pagesCollection()],
      fieldTypes: [PAGE_BUILDER_FIELD_TYPE],
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
