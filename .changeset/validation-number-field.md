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

The schema builder and the form builder now draw validation bounds with the
same control.

Both drew their own before, and they disagreed about what a bound accepts: one
allowed a minimum length of -5 or 2.7, the other did not. Lengths and row
counts are now whole numbers of zero or more everywhere, while a bound on a
value stays free to be negative or fractional.

Clearing a bound now means "no bound" rather than zero, in both builders, and
each control carries its own identifier so two editors open at once no longer
share one.

Plugin authors can use the same control: `ValidationNumberField` is available
from `@nextlyhq/plugin-sdk/admin`.
