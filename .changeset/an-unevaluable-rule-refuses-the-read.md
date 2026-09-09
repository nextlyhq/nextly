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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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

A collection read rule that cannot be evaluated now refuses the read instead of resolving to no restriction at all.

`getAccessQueryConstraint` answers `null` for "allowed, with nothing to narrow", and callers fold that into the query as the absence of a filter — so swallowing a failure into `null` removed the rule's narrowing and returned every row. The gate beside it evaluates the same stored rules and already fails closed on an unexpected error, "for safety" in its own words, so the two disagreed about what a failure means. They now agree. A missing collection keeps its existing passthrough, which the read paths report as a 404 rather than as an authorization decision.

In practice both read paths run that gate first and it denies before this is reached, so no shipped read is known to have widened. The value is that the guarantee stops depending on a caller remembering to ask the other question first.
