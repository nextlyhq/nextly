---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Retire the insecure `webhook-notification` prebuilt hook

The `webhook-notification` prebuilt hook (selectable in the Schema Builder's
Hooks editor) delivered over a bare `fetch` with no SSRF protection, and its
`secret` produced a base64 of the payload rather than a real HMAC. A signature
that is not an HMAC gives a false sense of authenticity, so the hook is removed
rather than left in place.

Use Nextly's signed webhook system instead: add an endpoint under **Webhooks**
in the admin. It delivers HMAC-signed, SSRF-guarded requests through the
delivery engine.

Migration: any collection that still has a stored `webhook-notification` hook
degrades to a no-op after upgrade (the write path skips unknown hook ids and the
admin hides the missing card), so content keeps saving. Re-create the
notification as a Webhooks endpoint to restore delivery.
