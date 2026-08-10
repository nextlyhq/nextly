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

A plugin can now declare data for another plugin statically, and the page builder registers contributed blocks from it.

`contributes.declarations` is the static counterpart to `contributes.services`. A service is a factory, so what it provides is knowable only once a plugin has booted — and `nextly generate:types` boots nothing, reading the config alone. A capability offered only through a service is therefore invisible to generation and cannot appear in generated types, an import map, or a manifest.

A block contributor can now declare its blocks instead of registering them by hand, and the page builder registers them at boot from the same declaration the tooling reads, attributed to the plugin that declared them. Registering imperatively from `init` still works for a plugin whose block list depends on runtime state.
