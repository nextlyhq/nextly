---
"create-nextly-app": patch
"nextly": patch
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
---

A Builder save left part-way is settled more fully at the next development start. A collection save that applied whole has its registry row brought up, as a Single's is. A save that applied whole but whose record keeps no saved definition holds back the start's registration and code-first reload, so a stale registry row is not built on, and a create stopped before its registry row is settled again once the start's migration step has added the row. The start's migration step reads the folder the app's saves write to, so a pending save under a `basePath` other than the working directory finishes. A Builder save is now refused while a save of another entity, or another machine's save that applied its own files, is left part-way; the refusal names how to settle each one, and ends as the CLI code `BUILDER_SAVE_EARLIER_LEFT`.
