---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A submission's page shows each notification it sent and, for each recipient, Waiting, Retrying, Sending, Sent, Sent after N retries, Failed or Cancelled (and why), and when; a notification whose recipients differ reads Partly sent. A notification's page lists its recent sends. The Form Builder keeps each send's per-recipient outcome with the submission, by masked hint and keyed digest, updated in the same transaction as each change of the queued email, so it outlives the 90-day delivery log and is deleted with the submission.

Resend sends a notification again to the recipients who have not received it, plus any the person ticks, and records who asked. It needs both `update-<submissions>` and `manage-email-deliveries`, is refused while a send is in progress, and retires a failed earlier send whose message is still held.

Migration: `form-submission-sends` gains fields (form, notification and its name, state, attempts, retries, when it changed, cancel causes, configured and final recipients, who asked and the resend), and a new internal collection `form-submission-resends` keeps Resend's requests. Run `nextly migrate:create` and `nextly migrate` (or `nextly db:sync` in development). Sends recorded before the upgrade are not listed.
