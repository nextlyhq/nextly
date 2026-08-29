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

One scheduled endpoint now drains everything.

Webhook delivery runs on the shared job runner. If you schedule `/api/jobs/run`,
your webhooks are delivered by it — you no longer need a separate cron entry per
subsystem, and anything added later that needs a regular tick is covered by the
schedule you already have.

Nothing you have set up stops working. `/api/webhooks/drain` is unchanged and
still does exactly what it did; a deployment scheduling it can carry on. If you
schedule both, they simply share the work — deliveries are claimed under a lease,
so the same event cannot be sent twice, and whichever pass arrives second finds
nothing left to claim.

Both triggers now read one set of limits for how much a single tick may do, so
they cannot drift into behaving differently depending on which one fired.

A drain pass that ends with failed deliveries is now reported. The job itself
completes — a failed delivery is retried on its own schedule and is not a failed
pass — so previously a receiver that had quietly stopped accepting anything left
no trace outside its own delivery rows.
