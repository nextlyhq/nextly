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

Each email delivery now records which version of its template was sent, the provider's answer to a failure, and the queued email it was an attempt of. Staff can open a delivery or a queued email to see its timeline.

- **Template version:** each delivery records the template's owner (`core`, `plugin:<name>`, `site`, or `code` for the site's code version), whether the site had overridden it, and a digest of the version as saved. It never keeps the template's content or what it rendered to. A send without a template records `none`, and a record from before this change reads `not-recorded`.
- **Failures:** a failed recipient records the provider's answer as a kind (`retryable`, `refused` or `unknown`) with its status where the provider gave one, never the provider's own text.
- **Queued email:** each attempt's deliveries name the queued email, and a queued email that failed because of its template (it couldn't render, or its From or Reply-To rendered to something that can't be sent) says so, for "Fix template".
- `GET /api/email-deliveries/:id` reads a delivery with its timeline. `GET /api/email-deliveries/queued/:id` reads a queued email with every delivery its attempts recorded, whether its template caused its failure, and the template version its latest attempt sent. On the Direct API these are `nextly.emailDeliveries.findByID` and `findQueuedByID`, which answer null for an id that names nothing. Both need `read-email-deliveries`, and neither returns an address, subject or body.
- Ids are matched in any letter case, and provider types exactly, on every dialect. An overdue count of exactly 100 is no longer reported as capped. A queued email whose job has been pruned shows its attempts as unknown (null), not 0. A queued template name that isn't slug-shaped (an address passed by mistake) is recorded as no template. The module singleton's `nextly.emailDeliveries` reads keep their optional arguments.

Migration: the core reconcile adds six nullable columns to `email_deliveries` (`queued_id`, `template_owner`, `template_overridden`, `template_digest`, `failure_kind`, `failure_status`) an index on `queued_id`, and an index on (`template_slug`, `created_at`, `id`) for one template's deliveries in order, in place, with existing rows kept.
