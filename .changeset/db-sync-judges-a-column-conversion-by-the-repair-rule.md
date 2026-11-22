---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

`db:sync` and the development push judge a column type change by the rule
`nextly repair-columns` uses, and describe it in the same words.

When the configuration changes a saved column's type, the rows the column holds
decide what happens, before any statement runs:

- A conversion that keeps every value goes ahead without a question, terminal or
  not, and says so: `posts.price: numeric(10,2) -> double precision, safe (rows checked: 120)`.
- A conversion that would clear values (an empty string in a group held as text,
  becoming JSON) names the rows by id and needs the data-loss consent naming the
  column: `--accept-data-loss=posts.seo` or `NEXTLY_ACCEPT_DATA_LOSS=posts.seo`, or
  a yes at the terminal, asked per column and defaulting to no. Consented, exactly
  the named rows are cleared, then the column is converted. A consent without a
  list, or one naming only the table, does not cover it.
- A conversion that would cut or change values is refused, naming the rows and
  what to change, instead of failing with the database's own error.
- A type change the rule has no conversion for is asked about as before, now
  saying how many rows hold a value.

The warning shown is the changed database's own, and is now correct for MySQL:
text that is not valid JSON is refused, not coerced. `db:sync --dry-run` lists
the same refusals, consents and safe conversions. Schema Builder saves are
unchanged.
