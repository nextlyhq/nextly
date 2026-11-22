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

Every command now checks the configuration with one set of rules before doing anything else and reports every problem in it, each at its path with what to do, then a count (`CONFIG_INVALID`), where it stopped at the first `defineCollection` that threw or, for plain objects, did not judge them at all. Compatibility: `defineCollection`, `defineSingle` and `defineFieldGroup` no longer throw on a problem; they return the entry as declared, marked, and the configuration's load or start reports it with the rest. Every command refuses a configuration with problems, plain objects included. At a running site's start, a plain-object entity with a problem is logged as a warning with its path and what to do, and the site starts as it did; an entity declared through `define*` is still refused at the start, with every problem listed.
