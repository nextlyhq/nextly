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

On the first start after upgrading to a version where visitors are judged by the Public role, Nextly logs once which collections and Singles visitors could read before and can't now: those with no `read` rule, or one answering visitors with a filter, whose read the Public role doesn't hold. To let visitors read one with no `read` rule again, declare `access: { read: () => true }` on it, and the Public role is granted its read at the next start, or grant the Public role its read (`read-<slug>`) on the Roles screen. For one whose rule answers a filter, grant the read: the filter still applies. A rule that refuses visitors, with `false`, `null` or a filter that isn't well formed, is never named. A new install isn't told, and the notice isn't repeated.

The startup log of what the Public role doesn't hold yet no longer names reads with no `read` rule at every start, since a collection kept private that way is ordinary. It still names reads whose rule answers a filter, writes whose rule answers `true`, and rules that failed when asked.
