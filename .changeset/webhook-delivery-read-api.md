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

Read a webhook endpoint's delivery log over the REST API.

Two new read-only routes back the admin delivery viewer:

- `GET /api/webhooks/:id/deliveries` — a paged, newest-first list of an
  endpoint's deliveries (joined to their event for type and resource), with
  optional `status` and `eventType` filters.
- `GET /api/webhooks/:id/deliveries/:deliveryId` — one delivery with its full
  attempt history and last response snippet.

Both require `read-webhooks`. Deliveries are scoped by endpoint id and remain
readable after an endpoint is retired, so its history is not lost. The delivery
record stores only retry state, status/latency/error, a response snippet, and a
per-attempt log — never the request headers sent — so this surface cannot leak a
receiver credential.
