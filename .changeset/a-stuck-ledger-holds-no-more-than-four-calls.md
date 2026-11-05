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

With nextly's cache handlers, a database that stops answering now holds at most four cache tag ledger calls of each kind per process, a record or a lookup, from the moment they start. Before, every write and lookup in the first five seconds of an outage started a call of its own before any was given up on. Further calls wait for a slot within the same five seconds, and are turned away rather than started if a call of their kind is given up on meanwhile. A call of a withdrawn ledger that never answers no longer holds back the ledger installed after it, and a call still waiting for a withdrawn ledger's slot is turned away when the next is installed, never started against the withdrawn one. A retry turned away while an earlier record is stuck no longer stops that record, landing late, from counting as the expiry it was, so the retry doesn't record it a second time. After a hot reload, an expiry an earlier copy of nextly's cache module looked up is asked about again before it is judged by, so this copy never judges it by a clock offset it learned before a database failover. If that lookup fails, it is not asked again before the lookup lifetime passes, and meanwhile the expiry counts as no earlier than the failure, so entries begun before then are still refused.
