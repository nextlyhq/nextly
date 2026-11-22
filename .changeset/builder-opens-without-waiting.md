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

Opening an entry, and the page builder above all, waits on fewer requests in a row. The entry is read in one request instead of two: `GET /collections/<slug>/entries/<id>` takes a new `?stored=1` option that adds `_stored`, the entry as a `depth=0` read in the same language and view returns it, read beside the entry's own read as the same caller, with the same access rules and hooks; if either read fails, the request fails. The editor starts that read beside the collection's schema rather than after it, and starts reading which releases hold the entry and its recovery point as the page opens, rather than once the editor is drawn. At the page builder's address, the builder's code and its start-up read are fetched as the admin loads. The start-up route's answer now says whom it was read for (`readFor`), and the editor hands that early read only to that person, so an account that signs in after it was sent reads its own. The builder's check for changes saved elsewhere takes its first mark from the canvas's first read (the canvas bindings route now answers with `stamp`, the check's mark of what it read, taken before reading), rather than asking once the canvas is drawn: one request fewer, and a save that lands while the canvas first reads shows at the next check rather than with the next save. Nothing about what the editor shows or saves changes, and the document lock is still claimed before any edit.
