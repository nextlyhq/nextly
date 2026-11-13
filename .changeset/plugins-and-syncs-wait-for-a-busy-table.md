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

Plugin migration modules, `migrate:fresh`, `prune`, `db:sync`, the development push and start, and the `upgrade` steps now wait for a table another session holds in short tries, as `nextly migrate` does, instead of waiting without a bound. Plugin modules run in tries through `nextly migrate`, the boot step, `plugins install`, `plugins uninstall` and `migrate:down --plugin`. `migrate:fresh`'s drops, `prune`'s statements, the development start's table creation and the `upgrade` steps run one statement per try on one connection. The schema pipeline's apply runs in tries for `db:sync`, the development push and the Builder's apply, asking its questions once. A run that stops on a busy table names the table and what holds it, and changes nothing more.
