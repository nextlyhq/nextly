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

Nextly can now run work in the background — reliably, at a chosen time, and as
a chosen person. This is the foundation the scheduled-publishing work needs, and
it replaces the pattern where each feature that needed background work grew its
own private runner.

A job records what to run, when it may start, whose authority it runs with, and
how many attempts it gets. It survives a restart, because it is a row in your
database rather than something held in memory, and it works on PostgreSQL, MySQL
and SQLite with nothing extra to install — no Redis, no separate queue service,
nothing to run alongside your site.

Two things it will not do, both deliberate.

Two processes will not pick up the same job at the same moment. Whichever gets
there first takes a short lease on it, and the other simply leaves it alone. If
the first stalls long enough for the lease to lapse, another picks the job up —
and the stalled one is then refused when it tries to record what it did, so a
slow worker cannot overwrite the result of the one that replaced it.

A job that is still being worked on holds on to its claim: the lease is extended
while the handler runs, so ordinary long-running work does not get taken over
part-way through.

That is still a guarantee about the RECORD rather than about the work. If a
process stalls or loses its connection, it stops extending the claim while
whatever it was doing may still be in flight, and another process can pick the
job up. Every durable queue works this way — it is not possible to promise
otherwise once a job can touch something outside the database — so a handler
should be written so that running it twice is harmless.

Finished jobs are cleared out on a rolling window rather than kept forever, so a
job that runs every few minutes does not fill the table with its own history.

It will not quietly run as somebody more powerful. A job remembers who queued
it, and it acts as that person, with their roles. If that account has since been
deleted or deactivated, the job stops and says so rather than continuing with no
identity — which would mean running with no access rules applied at all. It also
never falls back to an administrator or a system account.

Failures back off before trying again, and the wait is deliberately staggered.
When one destination goes down, everything queued for it fails at the same
moment; without staggering they would all retry at the same instant, and hit the
recovering destination with the entire backlog at once, over and over. Retries
are also capped, and a job that keeps failing eventually stops and records why.

A run is time-boxed, so it finishes cleanly inside a scheduled task or a
serverless function rather than being cut off partway. Anything it did not reach
is still queued for the next run.

Nothing is silently skipped. A job whose type no longer exists in your code is
recorded with that reason rather than passed over — a queue that never drains
looks exactly like an empty one, and this makes the difference visible.
