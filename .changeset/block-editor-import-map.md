---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

A block that supplies its own editor component now loads without a hand-written import.

A block can name a custom inspector or canvas component through `editor.component`. That is a component path like any other admin contribution, so it now goes into the generated admin import map alongside plugin pages, settings and views — the editor bundle picks it up with no host wiring.

Paths are read from what plugins declare, so generation needs no plugin to boot. A block registered imperatively at runtime contributes no path, the same rule the block manifest follows. An app whose only components come from blocks now gets an import map too, where before none was written.
