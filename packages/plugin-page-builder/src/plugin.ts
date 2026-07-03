import { definePlugin } from "@nextlyhq/plugin-sdk";

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
    enabled: opts.enabled,
    contributes: {
      collections: [pagesCollection()],
      permissions: [
        { action: "publish", resource: "pages", label: "Publish Pages" },
      ],
      admin: {
        menu: [
          { label: "Pages", to: "/admin/collections/pages", icon: "Layout" },
        ],
      },
    },
  });
