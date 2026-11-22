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

Email templates can be written in blocks instead of HTML (`@experimental`). A template saved with `format: "written"` and `blocks` (heading, text with bold, italic and links, button, image, divider, spacer, and a list that repeats its blocks for each item, each block optionally shown on a variable) renders email-safe inside its layout and the brand settings, with a plain-text part written from the blocks, the same way in a preview, a test and a send. Variables in blocks escape for where they sit, and a link or image address from a variable is kept only when it is a web or mailto address. Every existing template is coded and renders exactly as before; a coded template is never turned into blocks. Templates gain the `has_value`, `as_list` and `safe_url` Liquid filters.
