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

A job handler is told which job it is running.

Delivery is at-least-once, so one queued job can reach a handler more than
once, and the documentation says to write handlers that survive that. It did
not say how. The context carried the identity, the clock, a content API and the
tick deadline, and nothing that identified the queued row, so a handler had
nothing stable to key an external side effect on.

It now receives `jobId`, the same on every attempt, which is the key to hand a
payment provider's idempotency header or the unique column an upsert targets.
It also receives `attempt`, counting from 1, which is written to the row before
the handler starts, so a handler that dies part-way still leaves the count
advanced. It is not the deduplication signal: `attempt > 1` says an earlier run
began, not what it finished.

The same page told operators to size `leaseMs` to the work. Nobody could:
the built-in route passes only a batch size and a duration, and the public
configuration takes job definitions alone. It was also the wrong advice, since
the lease is renewed while a handler is alive and so already covers work that
merely takes a long time. The page now documents the fixed lease as a stall
tolerance and points at the key a handler can actually use.
