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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The Google Fonts catalogue no longer loads previews until you ask. Above the catalogue it says "Fonts you add are copied to your site. Visitors never contact Google." and, until you press **Show previews**, that previews would load from Fontsource. Your choice is kept for you, in the builder and on the admin's Fonts page, and until then each family is named in the editor's own font.

A role font written with a fallback, like `var(--unset, Lora), serif`, now counts as using Lora: the Fonts screen lists it and won't remove Lora while it's in use. When a Type tab row follows a text style, choosing a Body or Headings font leaves that row's font alone, as before; the Fonts screen now says so beside "Use <font> for" and in the toast once a role is chosen.
