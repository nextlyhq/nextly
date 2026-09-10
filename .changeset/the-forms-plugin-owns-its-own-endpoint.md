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

The form builder now serves its own public endpoints. `GET /api/forms`,
`GET /api/forms/{slug}` and `POST /api/forms/{slug}/submit` answer at exactly
those addresses, so no caller changes anything, but the plugin that owns the
collections is the one reading them.

The core used to serve those three, and named the `forms` and `form-submissions`
tables in four places while declaring neither. That meant they failed on any
install that renamed a collection through the plugin's own overrides, and they
were never reachable at all without the plugin installed, because the tables did
not exist. Nothing that worked before stops working.

Spam is now decided before a submission is validated on that route. A bot that
trips the honeypot while also omitting a required field used to receive a
validation error, which tells it which of the two it got wrong and stored no
evidence; it now receives what an accepted submission receives, and the flagged
row is kept for review. A submission the rate limiter refuses is answered the
same way rather than as a 429.

Three response helpers are exported for plugins serving their own HTTP routes:
`respondList`, `respondDoc` and `respondAction`, joining `respondMutation`. A
plugin taking over an endpoint has to answer in the body the endpoint already
answered in, and a hand-built one both drifts from the canonical shape and drops
the post-commit warnings these carry.

`trustedClientIp` is exported beside `getTrustedClientIp`, which needed
settings a plugin cannot read. Exported alone, the resolver was reachable and
unusable, leaving a plugin to read `x-forwarded-for` itself.
