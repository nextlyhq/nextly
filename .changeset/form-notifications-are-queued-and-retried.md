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

Form Builder notifications are queued through the queued email send once a submission is saved, instead of being sent once: the first attempt is made at once, and a failure a retry can help is tried again through the job queue until it is sent or fails for good, so a provider outage no longer loses a form's emails. Every notification setting is kept (provider, sender, static or field recipients, cc, bcc, reply-to, condition, template, attachments), the `form-builder.beforeEmail` filter still runs once before queueing, and each email carries its own idempotency key, from its submission, its place and its notification. Retries need the jobs trigger (`POST /admin/api/jobs/run`) to run. A queued email that fails for good is now logged with its reason (`queued-email-failed`, with its `queuedId`), so the Form Builder's own failure line can be matched to why.
