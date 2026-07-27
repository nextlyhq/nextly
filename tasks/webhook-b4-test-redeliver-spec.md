# B4 — Webhook test-ping + redeliver (spec)

Two operator/developer REST endpoints on the existing `webhooks` resource. Both
side-effecting → gated `update` + session-only, `respondAction`/`respondMutation`.

## 1. test-ping — `POST /webhooks/:id/test`

Verify an endpoint's connectivity + signature **without touching the outbox**.

- Load endpoint (`getEndpoint` for existence/enabled; `revealSecrets(id)` for
  active plaintext secrets). 404 if missing; 409/422 if no active secret.
- Build a synthetic **ping** envelope (new `webhook.ping` event type — added to
  the `WebhookEvent` type union so there is no `as`-cast; documented as
  system-emitted-only, never written to `nextly_events`, so fan-out/subscription
  never carries it). Payload identifies it as a test with a timestamp + endpoint
  id, no content data.
- `JSON.stringify` body → `buildSignatureHeaders({ id: pingId, timestamp, body,
secrets })` → merge endpoint custom headers → `safeFetch(url, { method:"POST",
headers, body, timeoutMs, maxResponseBytes })` → `classifyResponse(status)`.
- Return `respondAction("Test event sent.", { delivered, statusCode, latencyMs,
error?, responseSnippet })`. `ExternalUrlError` (SSRF/DNS) → `delivered:false`
  with a clear message, HTTP 200 (the probe ran; the endpoint is unreachable).

Reuses: `WebhookEndpointService.getEndpoint/revealSecrets`, `buildSignatureHeaders`
(`signing.ts`), `safeFetch` (`utils/validate-external-url`), `classifyResponse`
(`delivery-policy.ts`). New: `webhook.ping` type; a `testEndpoint` service method
returning the probe result; route + handler.

## 2. redeliver — `POST /webhooks/:id/deliveries/:deliveryId/redeliver`

Re-attempt a specific past delivery. Keyed by `(webhookId, deliveryId)` so it
reuses the existing delivery-log scoping.

- Resolve the delivery scoped by `(webhookId, deliveryId)` (404 if missing).
- Guard: endpoint not soft-deleted/disabled (409 if disabled); the referenced
  `nextly_events` row still exists with a payload (409 if pruned by retention).
- **Re-arm the existing delivery row** (the unique index forbids a second row for
  the same `(webhook, event)`): `status="pending"`, `next_attempt_at=now`,
  `locked_by=null`, `locked_until=null`, `attempt_count=0` (fresh retry budget),
  `updated_at=now`. Preserve the capped `attempts[]` history (append, never wipe).
  The delivery `id` (the Standard-Webhooks `webhook-id`) is reused, so a receiver
  that already processed it dedupes — the correct "try again" semantic.
- Offer the fast-drain so the re-armed row is attempted promptly (consistent with
  the outbox model); the scheduled drain is the backstop.
- Return `respondMutation("Redelivery queued.", <delivery summary post-rearm>)`.
  The outcome surfaces in the delivery log (`GET /webhooks/:id/deliveries[/:id]`).

Reuses: `WebhookDeliveryQueryService.getDelivery` (scoping), `WebhookFastDrainScheduler.offer`.
New: a `redeliver(webhookId, deliveryId)` mutation (re-arm) on a service; route +
handler.

## Non-goals (follow-ups)

- Event-scoped redeliver (`/webhooks/events/:id/redeliver` re-fan-out to all
  endpoints) — this spec does delivery-scoped only.
- Synchronous single-delivery result for redeliver (would need an exported
  `deliverOne` seam; the async log-based outcome is sufficient and consistent).

## Tests (per-dialect where SQL-touching)

- Domain integration (manual adapter wiring, frozen clock, fake transport):
  redeliver re-arms a `failed` row to `pending`/attempt_count 0, preserves
  attempts history, respects the unique index (no duplicate row), 404/409 guards;
  test-ping signs with the active secret and posts via an injected transport.
- REST handler unit tests (`api/webhooks.test.ts`): auth (update + session-only),
  wire shapes, 404s.
