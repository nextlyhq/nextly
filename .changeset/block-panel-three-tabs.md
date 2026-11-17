---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

The block panel has three tabs: Content, Style and Advanced. Content holds what a block says, shows or links to; Style how it looks; Advanced where and when it shows (Visible on, Show when, and Never quote this on a Section or a Box), then its HTML (its CSS id and attributes), all moved there from the end of Content as they are, with the folded "Advanced" section gone. A tab with nothing in it is not shown, so a Spacer has only Style and Advanced. The tab an author chooses stays chosen as they select other blocks: a block without it shows its first tab, and the next block that has it shows theirs again. Leaving Style that way returns a forced Hover or other state to Normal, as a click on another tab does. A block's settings placed in Advanced are drawn there, above the CSS id, and a block's own inspector still replaces only its Content controls.
