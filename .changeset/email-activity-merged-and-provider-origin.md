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

The Email hub's Activity can now be read as one merged list, and each provider says where it came from.

- **One merged list:** `GET /api/email-deliveries/activity` (Direct API: `nextly.emailDeliveries.activity`) lists queued emails, and deliveries from sends that weren't queued, newest first under one cursor (`before` / `meta.nextBefore`). A queued email's own deliveries are its timeline, not rows of their own.
  - Filters: `status` (a delivery's outcome or a queued email's state), `template`, `providerType`, `providerOrigin` (`stored`, `code` or `deleted`), and `from` / `to`.
  - Each row gives its kind, status, template (`{ slug }`, `none` or `not-recorded`), provider, recipient kinds, last failure reason, and, for a queued email, its attempts and next attempt. None returns an address, subject or body. It needs `read-email-deliveries`.
- **Provider origin:** every delivery's provider now carries `origin`:
  - `stored` for a provider row that still exists (only then is its `id` returned, on every dialect);
  - `code` for the site's configured provider;
  - `deleted` for a provider row deleted since;
  - `not-recorded` for a delivery written before origins were.
- **Queued email** records what it is (a message or a template), the kinds of recipient it goes to (never an address), and the provider its latest attempt went through. One not yet tried has no provider.
- A route with a segment past a queued email's id no longer resolves to its detail.

Migration: the core reconcile adds a nullable `provider_origin` column to `email_deliveries`. It also adds nullable `message_kind`, `recipient_kinds`, `provider_type`, `provider_id` and `provider_origin` columns to `email_queue`, in place, with existing rows kept. Older rows read as not recorded.
