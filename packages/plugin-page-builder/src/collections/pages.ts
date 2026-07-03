import { defineCollection, text, json, code } from "nextly/config";

import { defaultBlockRegistry, validateDocument } from "../core";

/** The admin Edit-view override — resolves to the full editor (registered in M4). */
export const EDIT_VIEW_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderEditView";

/**
 * The plugin-owned `pages` collection. `content` holds the serialized block tree.
 *
 * Node-side the block registry is empty at config-load (block renderers live in the
 * React `./render` entry), so the field validator runs with `allowUnknown: true` — it
 * enforces the security-critical structural invariants (depth / node count / unique ids
 * / namespaced types). Full block-type validation runs in the editor + renderer, where
 * the registry is populated. (Documented simplification; see M3 plan.)
 */
export function pagesCollection() {
  return defineCollection({
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      json({
        name: "content",
        validate: value =>
          validateDocument(value, defaultBlockRegistry, { allowUnknown: true }),
      }),
      code({ name: "customCss", admin: { language: "css" } }),
    ],
    status: true,
    admin: {
      useAsTitle: "title",
      components: { views: { Edit: { Component: EDIT_VIEW_PATH } } },
    },
  });
}
