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

Code and plugins can now queue an email (`@experimental`):
`nextly.email.queue` and `queueWithTemplate`, and the same two on a plugin's
`ctx.services.email`, take every option `send` and `sendWithTemplate` take.
A queued email is stored, sent right away, and retried through the job queue
when the provider fails temporarily, with backoff for up to about three hours
(15 attempts); a failure that is not temporary fails it at once. Every attempt
sends with the caller's `idempotencyKey`, or with a key of the queued email's
own, so a retry after a lost response is not delivered twice where the provider
takes a key. A template is rendered at each attempt.

A plugin can pass its transaction as `tx`: the email is then stored in that
transaction, exists only if it commits, and is attempted once it has. An email
stored but never attempted, because the process stopped, is sent the next time
the jobs trigger (`/api/jobs/run`) runs, and the server log warns at startup
and on each queued send when a queued email is more than 15 minutes past due
because the trigger isn't running.

The message is held in a new `email_queue` table, sealed under `NEXTLY_SECRET`;
the job carries only its id. `nextly migrate` and boot add the table on all
three databases. Sends that are not queued are unchanged.
