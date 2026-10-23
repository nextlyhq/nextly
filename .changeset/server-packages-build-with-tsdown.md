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

`nextly`, the database adapters, the storage adapters, the plugins, the plugin SDK, `@nextlyhq/blocks-engine`, `@nextlyhq/blocks-react` and `create-nextly-app` are now built with tsdown instead of tsup. Every entry point exports the same names, and its types describe the same API.

What a reader of `dist` sees change:

- `nextly`'s type declarations are `.d.mts` files beside the `.mjs` files they describe, rather than `.d.ts`. Imports resolve through the `exports` map as before, so no import changes.
- The declarations of `nextly/route-path`, `nextly/field-catalog`, `nextly/widget-gate`, `nextly/widget-result`, `nextly/document-lock` and `nextly/translation-filter-states` sit beside their modules (for example `dist/runtime/routing/slug-param.d.mts`), and the `exports` map points there.
- Shared code is split into chunks with different names, and file-level comments at the top of a source file are no longer copied into the declarations. Comments on each declaration are kept, so editor hovers read the same.
