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

`nextly generate:types` now writes a block manifest listing every block your plugins declare.

Until now the only way to ask what blocks an app has was to boot it and inspect the registry, which is not available to an editor build, a docs page, or an agent writing a page document. The manifest states it as a file beside your generated types: each block's name, schema version, description, worked example, prop schemas, style capabilities, slots, and the plugin that declared it.

It is written from what plugins declare rather than from the running registry, so generation stays a pure read of your config: no plugin boots and no database opens. Blocks registered imperatively at runtime are not listed, because they cannot be known without running the plugin. No file is written when nothing declares a block.
