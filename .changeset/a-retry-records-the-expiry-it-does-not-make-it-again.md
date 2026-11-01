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

With nextly's cache handlers installed, a database that takes connections but never answers can no longer hold cached public reads. Every call to the cache tag expiry ledger, a lookup or a record, is now given up on after 5 seconds, and a cached read waits at most a second on a retry of a refused record, which goes on in the background. Before, both waited for as long as the database did. A lookup that is given up on counts its tags as expired at that moment: entries cached before it are read afresh, and those cached after it are served, until the next lookup says what the ledger holds.

A retried cache tag expiry record now writes only to the ledger: it no longer expires the tag in the instance again, so a page regenerated since the write stays cached while the retries fail. When a retry succeeds, it is judged by the database time it read, as a write's own record is, since another instance may have recorded the same tag in that millisecond; a page regenerated during the outage is rebuilt once then. A record that answers after it was given up on is not made again by the retry. A refusal kept while a retry is under way waits the first retry delay again once that retry succeeds, and the tags a cache expiry hand-off gave back after its timeout are retried too, rather than waiting for the next write. Each record the ledger refuses is now logged with its tags (`cache-tag-record-failed`), a refusal during a retry included, so the content another instance may still serve stale can be named; the retries themselves are said only when they begin and when they succeed.
