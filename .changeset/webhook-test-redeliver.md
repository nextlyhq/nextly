---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/ui": patch
---

Test a webhook endpoint and re-send a past delivery over the REST API.

`POST /api/webhooks/:id/test` sends a signed synthetic ping to the endpoint and
reports whether it was reachable and accepted (status, latency, response
snippet), so a receiver can be verified — before or after it is enabled —
without producing a real event: the test writes nothing to the outbox or the
delivery log.

`POST /api/webhooks/:id/deliveries/:deliveryId/redeliver` re-attempts a specific
past delivery from its stored event payload. The existing delivery row is
re-armed for another attempt (its retry budget reset, its attempt history kept)
and the drain is nudged so it goes out promptly; the outcome then shows in the
delivery log. Both actions require the webhook update permission and an
interactive session.
