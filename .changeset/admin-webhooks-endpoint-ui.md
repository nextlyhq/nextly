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
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Manage webhook endpoints from the admin panel, under Settings → Webhooks.

Create an endpoint by naming it, giving it an HTTPS URL, choosing the events it
receives (any of the content, media, user, and form events, or "all events"),
and optionally adding static headers. The signing secret is shown once on
creation and is never included in a normal read or list, but it can be
retrieved later through the endpoint's privileged "Reveal signing secret"
action. Endpoints can be edited, enabled or
disabled, and deleted; deleting one stops its deliveries and clears its secret
while keeping its delivery history.

A "Send test event" action posts a signed ping to the endpoint and reports
whether it was reachable and accepted, so a receiver can be verified before it
is relied on. Header values are never displayed after they are set (they read
back hidden), so the form keeps them untouched unless you deliberately re-enter
the full set.
