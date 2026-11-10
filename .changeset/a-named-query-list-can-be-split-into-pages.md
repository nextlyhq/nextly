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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A Collection list whose source is a named query can be split into pages, as a collection list can: page `n` at `<address>/page/n` asks the query for the window that starts `limit` rows further on for each page before it, after the list's offset, the page links are counted from the query's total, and a page past the last is not found. Split into pages is refused at save, in the editor and through `set-list-query` on a list whose query is not declared with `total: true`; a page that already held it keeps saving with a warning. A query that stops returning a total draws the list's empty state, and the editor says why, rather than showing a guessed number of pages. A block in a custom source's list whose visibility condition reads the row is judged at save, and decided on the page, against the fields the query's rows declare. The editor's query listing and the composition manifest list a group's own row fields, however deep. A named query whose rows name both a collection and fields is refused at boot, and one drawn where nothing runs named queries no longer shows the item of a list around it.
