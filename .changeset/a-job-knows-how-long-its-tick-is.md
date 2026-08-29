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

A background job now knows how long it has.

Jobs run on a tick — a scheduler calls your site, the runner works through what is
due, and the platform ends the request. Work that walks an open-ended set, like
publishing every release that has come due, has to stop somewhere sensible and
leave the rest for the next tick. Until now nothing told it where that was: the
runner held the budget and never mentioned it, so anything wanting to be a good
citizen had to be handed the number separately.

Every job handler now receives `deadline` — the instant its pass intends to stop.
Short jobs can ignore it. A job that walks a large set should stop when it passes
and leave the remainder queued, which is safe because the queue is durable and
the next tick continues where this one left off.

Stopping early must leave the remaining work queued rather than marking it done.
Work that was never attempted produces no error, and an absence of failure is
easily mistaken for success.

Also fixed: a recurring job whose slug was near the maximum length was accepted
when you defined it and then silently refused when the runner tried to queue it,
so it never ran. Such a slug is now rejected where you write it, with a message
naming the real limit.
