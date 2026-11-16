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

Staff can now read email deliveries and queued email through new routes and the Direct API. None of them returns an address, a recipient digest, a subject or a body.

- `GET /api/email-deliveries` lists delivery records newest first. Each shows its outcome, template, provider, recipient kind (to, cc or bcc), failure reason, and whether it named a person or was erased since. Filter by `outcome`, `template`, `providerId`, `providerType`, and `from` / `to` (ISO 8601). Lists answer `{ items, meta }` and are walked by cursor: `limit` (at most 100), then the `before` the previous page returned as `meta.nextBefore`.
- `GET /api/email-deliveries/queued` lists queued emails newest first. Each shows its state (waiting, retrying, sending, sent, failed or cancelled), attempts, next attempt, last failure, template, who queued it, and whether its message is still held. Filter by `state`, `template` and time.
- `GET /api/email-deliveries/last-sent` gives each template's last-sent time (`?slug=` names particular templates), with `keptSince`, the start of the delivery log's retention window. A template left out hasn't been sent since then.
- `GET /api/email-deliveries/overdue` says how many queued emails are more than 15 minutes past due because the jobs trigger isn't running.
- On the Direct API, the same reads are `nextly.emailDeliveries.find`, `findQueued`, `lastSent` and `overdue`. Their argument and result types are exported from `nextly`, marked experimental.

Each read needs the new `read-email-deliveries` permission, as does a checked Direct API call. `manage-email-deliveries` does not include it.

Migration: `read-email-deliveries` is seeded on the next start and granted to super-admin only. The core reconcile adds two indexes on `email_deliveries` (template, status and time; provider type and time), and a nullable `template_slug` column on `email_queue` with two indexes (time, and template with time), in place and with existing rows kept. An email queued before this change shows no template, as does one queued with a template name longer than 255 characters, which no template can have.
