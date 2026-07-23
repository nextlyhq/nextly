# U1 — Admin Webhooks UI: Design Spec

**Date:** 2026-07-24 · **Branch:** `feat/admin-webhooks-ui` (off `main` @ `c3bd115d`) · **Worktree:** `nextly-worktrees/webhook-u1`

**Goal:** Make the merged webhook backend (endpoint CRUD, signing secret, delivery log, test-ping, redeliver, drain) usable from the admin panel — a Settings → Webhooks surface an operator can manage without touching the API.

## Founder decisions (locked)

1. **Placement:** under **Settings** (`/admin/settings/webhooks`), beside API Keys, using `SettingsLayout`.
2. **Phasing:** **2 PRs** — PR1 = endpoint management (CRUD + secret + Test); PR2 = delivery log (list + dedicated detail page + Redeliver + manual drain).
3. **Delivery detail:** a **dedicated page** (`/admin/settings/webhooks/:id/deliveries/:deliveryId`), not a slide-over.
4. **Manual drain:** **include** a "Process queue now" action.

## Architecture & house patterns (from research)

The admin is a Vite/CSR bundle at `/admin` with a **custom route registry** (not Next file-routing). Every surface is wired in three places:

- `packages/admin/src/constants/routes.ts` — route constants + `buildRoute`/`withQuery`.
- `packages/admin/src/pages/registry.ts` — static import + `{ component, type:"private", requiredPermission }`.
- `packages/admin/src/constants/navigation.ts` — sidebar item (under the Settings subgroup).

Data flow (copy verbatim): **TanStack Query hook → service module → `fetcher`/`protectedApi` → canonical `{items,meta}`/`{message,item}` envelope**, mutations do **invalidate-and-refetch** (no optimistic updates). Errors via `parseApiError` + `apiErrorMessage`; feedback via Sonner `toast` from `@admin/components/ui`. Forms are **presentational** RHF+zod (`onSubmit`+`isPending` props; the page owns the mutation). Styling is **token-only** (`--nx-*` semantic Tailwind utilities), both light+dark, `rounded-none`, WCAG-guarded by the vitest contrast test.

**Models to copy:** API Keys feature (`packages/admin/src/{components/features/api-keys,pages/dashboard/settings/api-keys,services/apiKeyApi.ts,hooks/queries/useApiKeys.ts}`) for CRUD+secret; Users (`.../users`, `DataTableView`+`Pagination`) for the list; `VersionHistorySheet` patterns for the detail page layout.

## API bindings (exact — from the backend contract)

Base: `${origin}/admin/api`. All write ops are **session-only** (cookie); list/get allow it too.
| UI action | Method · path | Perm | Envelope → type |
|---|---|---|---|
| List endpoints | GET `/webhooks` | read | `{items: WebhookEndpointSummary[], meta}` (single synthetic page) |
| Get endpoint | GET `/webhooks/:id` | read | bare `WebhookEndpointSummary` |
| Create | POST `/webhooks` | create/update | 201 `{message, item:{doc, secret}}` — **secret shown once** |
| Update / enable-disable | PATCH `/webhooks/:id` | update | `{message, item}` (enable via `{enabled}`) |
| Delete | DELETE `/webhooks/:id` | delete/update | `{message, id}` (soft-delete) |
| Reveal secret(s) | GET `/webhooks/:id/secret` | **update only** | `{secrets: string[]}` |
| List deliveries | GET `/webhooks/:id/deliveries?page&limit&status&eventType` | read | `{items: WebhookDeliverySummary[], meta}` |
| Delivery detail | GET `/webhooks/:id/deliveries/:deliveryId` | read | bare `WebhookDeliveryDetail` (`attempts[]`, `lastResponseSnippet`) |
| Test | POST `/webhooks/:id/test` | update | `{message, ...WebhookTestResult}` (409 if no secret) |
| Redeliver | POST `/webhooks/:id/deliveries/:deliveryId/redeliver` | update | `{message, item: WebhookDeliveryDetail}` |
| Drain now | POST `/webhooks/drain` | update + same-origin | `{message, item: RunDrainResult}` |

**Types:** `WebhookEndpointSummary { id,name,url,enabled,eventTypes,headers(redacted),secretPrefix,createdBy,createdAt,updatedAt }` (no secret, no lastDelivery). `WebhookDeliverySummary { id,webhookId,eventId,eventType,resource,status,attemptCount,lastStatusCode,lastLatencyMs,lastError,nextAttemptAt,eventCreatedAt,createdAt,updatedAt }`. `WebhookDeliveryDetail extends Summary { attempts: {at,outcome,statusCode?,latencyMs?,error?}[], lastResponseSnippet }`. `WebhookTestResult { delivered,statusCode?,latencyMs,error?,responseSnippet? }`. `RunDrainResult { rounds,eventsProcessed,deliveriesCreated,attempted,delivered,retried,failed,abandoned,pruned }`.
**Event catalog (15 + wildcard):** entry.{created,updated,deleted,published,unpublished,status_changed}, single.{updated,published,unpublished}, media.{uploaded,updated,deleted}, user.{created,deleted}, form.submission.created, plus `"*"` (must be used alone).
**Redaction rules the UI must honor:** never render `secretHash`; header **values** come back as `"<redacted>"` (show names, treat values as write-only; never send the sentinel back); secret is visible only on create (once) and via the reveal route.

---

## PR1 — Endpoint management (`feat/admin-webhooks-ui`, PR #1)

**Routes/registry/nav:** add `WEBHOOKS`, `WEBHOOKS_CREATE`, `WEBHOOKS_EDIT` constants; register pages `read-webhooks`/`update-webhooks`; add a Settings-subgroup nav item (new icon in `@admin/components/icons`).

**Files (new):**

- `services/webhookApi.ts` — `listWebhooks`, `getWebhook`, `createWebhook`, `updateWebhook`, `deleteWebhook`, `revealSecret`, `testEndpoint` (typed to the envelopes above).
- `hooks/queries/useWebhooks.ts` — key factory `webhookKeys`, `useWebhooks`, `useWebhook`, `useCreateWebhook`, `useUpdateWebhook`, `useDeleteWebhook`, `useRevealSecret`, `useTestEndpoint`; each mutation invalidates `webhookKeys.all()`. Export via `hooks/queries/index.ts`.
- `pages/dashboard/settings/webhooks/index.tsx` — `SettingsLayout` + `PageContainer` + header + "Create endpoint" link + `WebhookTable`.
- `pages/dashboard/settings/webhooks/create.tsx` — owns `useCreateWebhook`, renders `WebhookForm`, on success opens the secret-reveal modal then routes to list.
- `pages/dashboard/settings/webhooks/edit/[id].tsx` — loads endpoint, renders `WebhookForm` seeded (reset-only-when-not-dirty), plus Reveal-secret and Delete.
- `components/features/webhooks/WebhookTable.tsx` — `DataTableView` cols: name, url (truncated), status badge (enabled/disabled), event types (chips, "All events" for `*`), `secretPrefix`, created. `rowActions`: Edit, Enable/Disable (toggle via update), Test, Delete(destructive). Loading/empty(illustrated CTA)/error states.
- `components/features/webhooks/WebhookForm.tsx` — presentational RHF+zod: name, url, event-type multi-select (checkbox list + "All events" that enforces `*`-alone), headers editor (name/value rows; values write-only, blank = leave; never submit `<redacted>`), enabled toggle. `isPending` submit button.
- `components/features/webhooks/WebhookSecretModal.tsx` — one-time secret reveal (copy-to-clipboard, "store it now, unrecoverable" warning); reused by create + the reveal action.
- `components/features/webhooks/DeleteWebhookDialog.tsx` — controlled `Dialog role=alertdialog`, `variant=destructive`, close-guard while pending, toast.
- `components/features/webhooks/TestEndpointButton.tsx` (or inline) — calls `useTestEndpoint`, shows result (delivered/status/latency/snippet) via toast + a small result panel; maps 409 (no secret) to a clear message.
- `components/features/webhooks/status.tsx` — status→badge-token mapping (endpoint enabled/disabled; delivery statuses for PR2). Register new pairings in `packages/ui/src/styles/contrast/pairings.ts`.

**Validation:** mirror the backend zod (name 1–255, url valid+≤2048, ≥1 event type, `*` alone, header name/value rules) so client errors are immediate; backend re-validates.

**Tests (PR1):** service + hook unit tests (mock `fetcher`); `WebhookForm` validation tests (event-type `*`-alone rule, header rules); status-badge contrast pairings added to the contrast test. Follow existing admin test conventions (verify during impl).

**Changeset:** one, all packages, patch. Conventional Commit `feat(admin): webhook endpoint management UI`.

## PR2 — Delivery log + detail + redeliver + drain (PR #2)

**Routes:** `WEBHOOKS_DELIVERIES` (`/admin/settings/webhooks/:id/deliveries`) and `WEBHOOKS_DELIVERY_DETAIL` (`/admin/settings/webhooks/:id/deliveries/:deliveryId`).

**Files (new):**

- `services/deliveryApi.ts` — `listDeliveries(webhookId, {page,limit,status,eventType})`, `getDelivery`, `redeliver`, `runDrain`.
- `hooks/queries/useDeliveries.ts` — `useDeliveries` (keepPreviousData for smooth paging), `useDelivery`, `useRedeliver`, `useRunDrain`; invalidate delivery keys on redeliver/drain.
- `pages/dashboard/settings/webhooks/[id]/deliveries/index.tsx` — delivery list: `DataTableView` cols status badge, event type, resource, attempts, last code/latency, next attempt, created; **filters** (status dropdown of the 5 states, event-type filter) that reset page; `Pagination`; a **"Process queue now"** button (`useRunDrain` → toast summarizing `RunDrainResult`, then refetch). Row → detail page.
- `pages/dashboard/settings/webhooks/[id]/deliveries/[deliveryId].tsx` — dedicated detail page: header (status, event type, resource, ids), metadata (attempt count, last code/latency, next attempt, timestamps), **attempts timeline** (`attempts[]` — per-attempt outcome/status/latency/error/time, newest first), **last response snippet** (monospace, from `lastResponseSnippet`), and a **Redeliver** button (`useRedeliver`, disabled-while-pending, toast, refetch). Honest empty note that request payload/headers aren't persisted.

**Copy nuance:** timestamps come back verbatim (`x-nextly-skip-timezone-format` header) — render as-is, don't re-localize.

**Tests (PR2):** delivery service/hook unit tests; detail-page render test (attempts timeline, redeliver disabled-while-pending); drain button toast. E2E (if harness allows): create endpoint → Test → (seed a delivery) → redeliver.

**Changeset + commit:** one changeset; `feat(admin): webhook delivery log and redelivery UI`.

---

## Cross-cutting

- **Permissions:** list/detail need `read-webhooks`; create/edit/enable/disable/delete/reveal/test/redeliver/drain need `update-webhooks` (registry `requiredPermission` gates the page; buttons additionally hidden/disabled without the perm).
- **Styling:** zero hardcoded colors; endpoint + delivery status badges use semantic tokens (success=delivered/enabled, warning=retrying/pending, destructive=failed/disabled, muted=processing/abandoned) — each new pairing registered in `contrast/pairings.ts`.
- **Accessibility:** dialogs `role=alertdialog`, focus states, keyboard nav; badges not color-only (include text).
- **Copy:** honest, no em dashes, no exclamation in success; developer-first tone.

## Non-goals (this program)

- Secret **rotation** UI (that's B5, next).
- Editing `filter`/`fieldAllowlist` (not settable via the API).
- Showing outgoing request payload/headers (never persisted, by design).
- Bulk endpoint actions (single-item actions only for v1).

## Risks / watch-items

- Header-value redaction: the edit form must not echo `<redacted>` back on save (leave-unchanged semantics). Cover with a form test.
- Event-type `*`-alone rule: enforce client-side to avoid a round-trip 400.
- Delivery list may be large: rely on server pagination + status filter; no client-side sort of the full set.
- Admin test harness conventions unknown until impl — confirm before writing tests; never add to the known-failing baseline.
