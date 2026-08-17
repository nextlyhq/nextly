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

Comparing two versions now opens a dialog sized for a comparison instead of a third mode inside
the 480px history panel. A diff is a two-column reading by nature, and that panel could not hold
two columns, so the comparison was written to stack; each field now states its before and after
side by side under headings naming the two versions, and folds back into a stack only where the
surface is genuinely too narrow for two. A field that exists on one side only says so on the
other, rather than leaving a blank that reads the same as an empty value. The history panel keeps
its list and preview and no longer swaps its body out to compare.
