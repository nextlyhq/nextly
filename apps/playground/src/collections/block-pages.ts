import { previewViewportsFromSiteStyle } from "@nextlyhq/plugin-page-builder";
import {
  defineCollection,
  json,
  previewUrlFromTemplate,
  text,
} from "nextly/config";

import { SITE_STYLE_DEFAULTS } from "../lib/site-style-defaults";

// Pages rendered by the code-first blocks renderer (`@nextlyhq/blocks-react`),
// served at /blocks/<slug> by apps/playground/src/app/blocks/[[...slug]]/page.tsx.
//
// Separate from the page builder's own `pages` collection because the two
// renderers store DIFFERENT documents. `@nextlyhq/blocks-engine` nodes carry
// `styles` (states x breakpoints) and a `visibility` object that can hold
// conditions; the page builder's nodes carry `style`/`styleHover` and a
// `visibility` that is only a per-breakpoint boolean map. A row written for one
// renderer is not readable by the other, so pointing `createBlocksPage` at
// `pages` would resolve rows it cannot draw.
//
// `title` and `slug` are declared explicitly so they replace Nextly's
// auto-injected reserved columns of the same name. `id`, `createdAt` and
// `updatedAt` are always auto-injected.
export const BlockPages = defineCollection({
  slug: "block-pages",
  labels: { singular: "Block Page", plural: "Block Pages" },
  // Draft/Published lifecycle. The route reads with the default `published`
  // scope, so an unpublished row must 404 rather than render.
  status: true,
  // Where a block page previews. Without this the collection resolves to
  // `notConfigured`, and a preview link minted for one of its drafts has
  // nowhere to send the reviewer — it verifies, then refuses, which is
  // indistinguishable from an expired link.
  //
  // `/blocks/` because that is where this collection's route is mounted, in
  // `src/app/blocks/[[...slug]]/page.tsx`. The mount is the application's
  // choice, so the path is stated here rather than guessed anywhere else.
  admin: {
    // Built through the shared helper rather than interpolated here. A slug
    // holding a URL-significant character — `?`, `#`, `%`, a space — changes the
    // meaning of a hand-built path instead of addressing the stored slug, so
    // `draft?mode=x` would redirect to the route for `draft` and the token's
    // entry comparison would then refuse it. The helper applies the same
    // encoding a stored `urlTemplate` gets, so both spellings resolve one entry
    // to one address.
    preview: {
      url: previewUrlFromTemplate("/blocks/{slug}"),
      /*
       * The viewports the preview pane offers come from THIS SITE's own
       * breakpoints rather than from a list invented here. A site whose tablet
       * is 991px would otherwise be offered a "Tablet" preset that sizes the
       * frame to 1024 and lands in a tier its stylesheet never uses.
       *
       * The reader is built HERE from the instance rather than taken from
       * `site-content`, which would be a cycle: that module imports
       * `nextly.config`, which imports this file. Deferring the import does not
       * help — it defers execution, while the edge in the module graph is what
       * a cycle check reads, and it is right to.
       *
       * `findSingle` is the whole of what reading a site style needs, so this
       * is the interface rather than a cut-down copy of a bigger reader.
       */
      breakpoints: previewViewportsFromSiteStyle({
        reader: async () => {
          const { getCachedNextly } = await import("nextly");
          // The CACHED instance, which takes no config: importing the config to
          // build one is the cycle this is avoiding. By mint time an instance
          // exists, because the request that is minting came through it.
          const nextly = await getCachedNextly();
          return { findSingle: args => nextly.findSingle(args) };
        },
        defaults: SITE_STYLE_DEFAULTS,
      }),
    },
  },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    json({
      name: "content",
      label: "Block document",
      admin: {
        description:
          "A @nextlyhq/blocks-engine BlockDocument. Rendered by blocks-react, not by the page builder.",
      },
    }),
  ],
});
