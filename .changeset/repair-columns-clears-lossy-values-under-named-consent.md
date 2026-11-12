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

`nextly repair-columns --apply` now converts a lossy column, one holding
values its new type cannot hold, when the data-loss consent names that column:
`--accept-data-loss=<table>.<column>`, or `NEXTLY_ACCEPT_DATA_LOSS`. The values
cleared, set to null, are exactly the rows the run's report names, and the
repair record keeps the consent and the count. The consent without a list, or
one naming only the table, does not cover a repair: the column is skipped and
the report says which consent would.

In a terminal, a run with no consent naming the column asks once per lossy
column, naming the count and the first rows, and the table is never held while
it waits for the answer. Whether a run may ask is decided before anything is
asked; a run that may not (no terminal, `--non-interactive`, CI or `--json`)
never reads standard input, and skips the column.

On MySQL the clearing is a step of its own, committed with its record, so a
stopped run resumes from it; a clearing still to run needs that run's own
consent. A value that would be cleared where the column does not allow a null
now blocks the conversion, since clearing it would need a value invented.
