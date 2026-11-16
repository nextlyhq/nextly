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

A plugin can claim each webhook it receives once, with `ctx.security.webhooks.claimDelivery(verified, { provider })`: once per plugin, provider and delivery id (or body, for a scheme with no id). A retry or replay of a processed delivery is answered `duplicate`, for the 30 days its record is kept, which is how long a timestamp-less scheme is safe from replay. In the plugin's transaction (`tx`) the claim commits or rolls back with its writes; without one it is a lease (5 minutes by default, `leaseSeconds`) the handler ends with `complete()` or `release()`, and a retry during it is `in-progress`, so a handler that fails never loses the delivery. Only the answer `verify` returned is accepted. Claims live in a new core table, `nextly_received_webhooks`, which `nextly migrate` adds to an existing database; no payload is stored, and claims are pruned on the retention runner and the scheduled drain. Experimental.
