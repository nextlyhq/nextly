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

Scheduled content releases now actually publish themselves.

The background job runner has had everything it needed to do this except the two
things that make it run: a way to be triggered, and a list of the work it knows
how to do. Both are here. A release drain is registered as a job type at startup,
and a new endpoint runs the queue.

Point your scheduler at `/api/jobs/run` — Vercel Cron, a system cron, or anything
that can make an HTTP request on an interval — and due releases publish without
anyone being awake. Each pass is bounded, so an invocation finishes well inside a
serverless time limit and the next one picks up where it stopped; the queue is a
table in your database, so nothing is lost in between.

Who may pull that trigger is the same question the webhook drain already
answered, and it now has one answer rather than two. A scheduler authenticates
with a shared secret — `NEXTLY_DRAIN_SECRET`, or Vercel's own `CRON_SECRET` —
compared in constant time. A person authenticates normally and needs the new
`manage-background-jobs` permission, which super-admins receive automatically.

Running the queue by hand grants nothing else: every job runs as the person it
was queued for, resolved when it runs, so pressing the trigger makes work that
was already scheduled and already authorized happen now. It does not let the
person who pressed it do that work themselves.

`background-jobs` is now a reserved name. If you have a collection or Single
called `background-jobs`, rename it before upgrading — a content type sharing a
name with a system resource would have its permissions treated as the system's,
and preset roles would quietly lose access to it.

When a release fails to publish — its author was deleted, a write was refused —
that member is now reported individually in your logs, with the document and the
reason, rather than being counted and forgotten while the release silently waits
for a retry that will never succeed.
