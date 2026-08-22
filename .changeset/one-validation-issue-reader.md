---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

One reading of a validation payload, and a guard that answers for the whole shape.

`parseServerErrors` traversed `data.errors` independently of `validationIssues`,
so the entry form and the SDK disagreed about a partial issue: one dropped it,
the other kept it with missing fields. Both now read through one normalizer and
the form derives its stricter subset from the result.

A blank message is reported as absent rather than carried, so a surface keying
issues by field falls back to its own wording instead of showing an author a
refusal with nothing in it.

`isApiError` checks every present field rather than `status` alone. It narrows
`unknown` across the SDK boundary, where another client's error carrying a
numeric status would otherwise be handed over as an `ApiError` whose `code` is
declared `string` and is not.
