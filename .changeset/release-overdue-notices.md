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

A release's owner is now told when it misses its time. A release still scheduled more than 10 minutes after its time gives its owner one notice of kind `releases.overdue`, recorded by each `releases:drain` pass before it runs anything, or, for a release published that late, in the transaction that publishes it. The notice says the release missed its time, or that it ran late. Both are keyed on the instant missed, so one miss is one notice, and a pass seen twice tells nobody again.

Where the site can send email, every new release notice, stopped or overdue, is also emailed to its person, with a key made from the notice's id, and only to an active person who may still read releases, asked again on every attempt. The job that sends the email is recorded in the notice's own transaction, so a notice never stands without it, and retries a send that may succeed later with backoff, as many times as a queued email. The email writes the release's time in the zone it was scheduled in, named, and links to the release only when `NEXT_PUBLIC_APP_URL` is set. `NoticesService` gains `byId`, and the stopped notice keeps the release's zone. A new job type, `releases:notice-email`, is registered.
