import { defineCollection, json, text } from "nextly/config";

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
    preview: {
      url: entry =>
        typeof entry.slug === "string" && entry.slug !== ""
          ? `/blocks/${entry.slug}`
          : null,
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
