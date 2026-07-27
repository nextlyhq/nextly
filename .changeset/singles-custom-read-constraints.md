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

Custom read rules are now enforced on Singles. A custom rule can answer with a yes/no or with a filter describing which rows the caller may see. On a Single the filter had nowhere to be applied, so those rules were left unenforced and a Single you restricted with one was readable by anyone who could reach it.

The filter is now handed to the database as the condition on the document fetch: if it selects nothing, the read is refused. That is the same filter a list read would apply, so a rule behaves the same way whether it guards a collection or a Single, and the decision is made against the stored document rather than a prediction about it.

Filters are held to the same shape rules as on collections. One that cannot be applied exactly is refused rather than partly applied, and a refused read fails closed without creating the Single.

A custom rule that returns no decision at all now denies. A rule is free to fall through without returning, and such a result was previously read as "allowed, with nothing to filter by" — admitting the caller and narrowing nothing. This affects collections as well as Singles.
