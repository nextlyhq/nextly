---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
---

`@nextlyhq/blocks-react` now emits a prepared document's slots in the order the
block DEFINITION declares them, not the order they happen to be stored in.

The renderer asks for its slots by calling `renderSlot` once per declaration,
so declaration order is the order the page presents. This tree is documented as
the render-equivalent one, so carrying stored order left its own key order
describing a page nobody is served, and made two documents that render
identically compare as different.

A slot the definition declares but the document never stored stays ABSENT rather
than being added as an empty array: an empty slot renders nothing either way,
and adding it would rewrite every document that omits an optional slot.
