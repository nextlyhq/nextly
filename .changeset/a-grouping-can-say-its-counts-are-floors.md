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

A grouped widget result can now say its counts are floors. `WidgetResult`'s
`groupBy` arm gains an optional `atLeast`, mirroring the `count` arm: a source
that has to read and authorize rows before it can group them may stop at a work
bound and still answer honestly — every bucket it returns is real, and each
count may be short. `truncated` keeps its own meaning, that buckets were left
out. The admin carries the new field to the card, and the `bars` chart marks
each count as a floor on screen, in its text alternative and in its table, with
a note beside the chart. Additive and optional: no existing source, card or
plugin changes.
