---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
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

Add webhook fan-out: turn durable events into per-endpoint delivery rows.

`fanOutDueEvents` is the drain's first phase. `recordEvent` writes only the durable event inside the content transaction; fan-out runs separately and matches each un-fanned event to the enabled endpoints (subscribed type plus the endpoint filter) and inserts one `nextly_webhook_deliveries` row per match. This keeps content writes fully decoupled from the webhook registry (the transactional-outbox split), so creating, disabling, or deleting a webhook can never fail an unrelated content write.

A new `fanned_out_at` marker column on `nextly_events` lets the drain find events still needing fan-out. Fan-out is idempotent under concurrent drains: each event is processed in its own transaction that inserts only the deliveries not already present, with the unique `(webhook_id, event_id)` index as the hard backstop, and a losing race simply retries on the next pass. Also adds the race-safe `WebhookEndpointRegistry` (cached enabled-endpoint load) and the pure `selectDeliveryTargets`. Delivery (signing, sending, retries) lands in a following change.
