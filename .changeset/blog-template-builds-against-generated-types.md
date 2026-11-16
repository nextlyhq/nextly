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

A blog scaffolded with `--approach visual` builds again. `nextly migrate` was refusing the template's own migration with "Deleting data needs consent", because the file writes default rows into its Single tables and created them `IF NOT EXISTS`, so the migrate check had to treat them as tables that might already hold data. The blog template's migrations now create those three tables outright, and writing them needs no consent.

A blog scaffolded with `--approach code-first` type-checks again once `nextly generate:types` has run: `bylineFromCreator` and the seed's Single writer no longer pass a plain `string` where the generated collection or Single slug union is expected. A site that renames the collections keeps naming them by slug, as before.

A visual blog's build now installs the plugin it registers from its own source (`nextly plugins install --all`). A production boot refuses any enabled plugin that nothing has installed, and `create-nextly-app` only installed plugins from `@nextlyhq/plugin-*` packages, so `next build` stopped on `/_not-found`.
