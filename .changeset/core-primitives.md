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
---

Add nine core block primitives.

Heading, text, list, quote, image, button, spacer, divider and embed join the containers already in the library, which is enough to build a real page. Each is a single element with no wrapper, no default padding and no hardcoded colour: styling belongs to the style system.

The accessibility contracts are part of the blocks rather than left to the author. A heading renders the level the author chose rather than one derived from nesting, so the page outline does not change when a block moves. A button renders an anchor when it has a destination and a button when it does not. An image always emits alt text, empty when it is decorative. A quote keeps its attribution outside the quotation. An embed is sandboxed, carries a title, and does not leak the page path to the embedded party.
