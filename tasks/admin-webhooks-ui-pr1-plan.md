# PR1 — Webhook Endpoint Management UI: Implementation Plan

> Executed inline. Steps are TDD where a unit is testable (services, hooks, validation, status map, form logic); presentational shell wiring is verified by build + type + lint + a render test.

**Goal:** Ship the Settings → Webhooks endpoint-management surface: list, create, edit, enable/disable, delete, one-time secret + reveal, and Test.

**Architecture:** Vite/CSR admin, custom route registry. TanStack Query hook → `services/webhookApi.ts` → `protectedApi`/`fetcher` → canonical envelopes. Presentational RHF+zod form. Sonner toasts. Token-only styling.

**Tech:** react, react-hook-form, zod, @hookform/resolvers/zod, @tanstack/react-query, @testing-library/react + user-event, vitest.

## Global constraints

- All webhook writes are **session-only** (cookie) — `protectedApi` handles this.
- Never render `secretHash`; header **values** read back as `"<redacted>"` — show names, treat values as write-only, never submit the sentinel.
- Envelopes: list `{items,meta}`, create `{message,item:{doc,secret}}`, update `{message,item}`, delete `{message,id}`, reveal `{secrets:[]}`, test `{message,...WebhookTestResult}`.
- Token-only styling, light+dark, `rounded-none`; new badge pairings → `packages/ui/src/styles/contrast/pairings.ts`.
- `NextlyError` N/A (admin consumes envelopes via `parseApiError`/`apiErrorMessage`).
- No `as any`/`@ts-expect-error`; what/why comment per change; one changeset (all pkgs, patch); Conventional Commit `feat(admin): webhook endpoint management UI`.

## File map

- `packages/admin/src/types/webhooks.ts` — shared UI types (mirror backend contract).
- `packages/admin/src/services/webhookApi.ts` (+ `__tests__/webhookApi.test.ts`).
- `packages/admin/src/hooks/queries/useWebhooks.ts` — key factory + query/mutation hooks; export via `hooks/queries/index.ts`.
- `packages/admin/src/lib/webhook-validation.ts` (+ `.test.ts`) — zod schema + helpers (event-type `*`-alone, header rules).
- `packages/admin/src/components/features/webhooks/status.tsx` (+ contrast pairings) — endpoint + delivery status→token/badge map.
- `packages/admin/src/components/features/webhooks/WebhookForm.tsx` (+ `.test.tsx`).
- `packages/admin/src/components/features/webhooks/EventTypeSelect.tsx`, `HeadersEditor.tsx` (form subcomponents; tested via WebhookForm).
- `packages/admin/src/components/features/webhooks/WebhookSecretModal.tsx`.
- `packages/admin/src/components/features/webhooks/DeleteWebhookDialog.tsx`.
- `packages/admin/src/components/features/webhooks/WebhookTable.tsx`.
- `packages/admin/src/components/features/webhooks/TestEndpointAction.tsx`.
- `packages/admin/src/pages/dashboard/settings/webhooks/{index,create}.tsx`, `edit/[id].tsx`.
- Wiring: `constants/routes.ts`, `pages/registry.ts`, `constants/navigation.ts`, an icon in `components/icons`.

---

### Task 1 — UI types

`src/types/webhooks.ts`: `WebhookEventType` union (15) + `WEBHOOK_EVENT_TYPES` const array + `WEBHOOK_EVENT_WILDCARD="*"`; `WebhookEventSubscription`; `WebhookEndpointSummary`; `CreateWebhookInput`/`UpdateWebhookInput`; `WebhookTestResult`. (Dates arrive as ISO strings over the wire — type as `string`.) No test (types only); verified by consumers + `check-types`.

### Task 2 — Validation (`lib/webhook-validation.ts`) — TDD

Interfaces:

- `webhookFormSchema: z.ZodType<WebhookFormValues>` where `WebhookFormValues = { name, url, eventTypes: string[], allEvents: boolean, headers: {name,value}[], enabled }`.
- `toCreateInput(values): CreateWebhookInput` / `toUpdateInput(values, original): UpdateWebhookInput` — maps `allEvents→["*"]`; drops header rows with empty name; omits a header whose value is blank on **edit** (leave-unchanged) but includes it on create; never emits `"<redacted>"`.
  Tests (`.test.ts`): name 1–255; url required + valid + ≤2048; `allEvents` XORs specific types (can't have both; must have ≥1 when not allEvents); duplicate/blank header names rejected; reserved header names (`webhook-*`, `content-type`, `user-agent`) rejected; `toUpdateInput` omits blank-value headers and never emits the redacted sentinel.
  Steps: write failing tests → run (`pnpm --filter @nextlyhq/admin test webhook-validation`) → implement → pass → commit.

### Task 3 — Service (`services/webhookApi.ts`) — TDD

Mirror `versionApi` mocking style (`vi.mock("@admin/lib/api/protectedApi")`). Functions:

```
listWebhooks(): Promise<WebhookEndpointSummary[]>            // GET /webhooks → res.items
getWebhook(id): Promise<WebhookEndpointSummary>             // GET /webhooks/:id (bare doc)
createWebhook(input): Promise<{doc; secret}>               // POST /webhooks → item
updateWebhook(id, input): Promise<WebhookEndpointSummary>  // PATCH /webhooks/:id → item
deleteWebhook(id): Promise<void>                           // DELETE /webhooks/:id
revealSecret(id): Promise<string[]>                        // GET /webhooks/:id/secret → secrets
testEndpoint(id): Promise<WebhookTestResult>               // POST /webhooks/:id/test → spread result
```

Tests: each hits the right method+path and unwraps the right envelope field; `testEndpoint` reads the spread shape (`{message,...result}`); `createWebhook` returns `item.doc`+`item.secret`. Commit.

### Task 4 — Query hooks (`hooks/queries/useWebhooks.ts`)

`webhookKeys = { all:()=>["webhooks"], lists:()=>[...all(),"list"], detail:(id)=>[...all(),"detail",id] }`. `useWebhooks()` (list), `useWebhook(id)`, `useCreateWebhook`, `useUpdateWebhook`, `useDeleteWebhook`, `useRevealSecret` (lazy/mutation), `useTestEndpoint` — mutations `invalidateQueries({queryKey: webhookKeys.all()})` on success; accept `{onSuccess,onError}` passthrough where the page needs the returned secret/result (create, reveal, test). Export from `hooks/queries/index.ts`. Verified by `check-types` + usage in pages (light hook test optional).

### Task 5 — Status tokens (`components/features/webhooks/status.tsx`) + contrast

`endpointStatusBadge(enabled)` and `deliveryStatusBadge(status)` → `{label, className}` using semantic tokens (enabled/delivered=success, disabled/failed=destructive, pending/retrying=warning, processing/abandoned=muted). Badges include text (not color-only). Add any new token pairing to `packages/ui/src/styles/contrast/pairings.ts`; run the ui contrast test. Commit.

### Task 6 — WebhookForm (+ EventTypeSelect, HeadersEditor) — TDD (RTL)

Presentational: props `{ defaultValues?, onSubmit(values), isPending, submitLabel }`. RHF+zod (`webhookFormSchema`). `EventTypeSelect`: "All events" checkbox that, when on, disables + clears the specific-type checkboxes (enforces `*`-alone); required-at-least-one otherwise. `HeadersEditor`: add/remove name+value rows; on edit, value inputs render empty with placeholder "unchanged" and show configured header names (redaction-aware). Submit button `disabled={isPending}` + `Loader2` spinner.
Tests (`.test.tsx`): renders seeded values; toggling All-events disables specific types; submitting invalid shows messages and doesn't call `onSubmit`; valid submit calls `onSubmit` with mapped values; edit with blank header value omits it. Commit.

### Task 7 — Secret modal + Delete dialog

`WebhookSecretModal({open,onOpenChange,secret})`: one-time reveal, copy-to-clipboard, "store now — unrecoverable" warning (token-styled). `DeleteWebhookDialog({open,onOpenChange,webhook,onConfirm,isPending})`: `Dialog role=alertdialog`, `variant=destructive`, close-guard while pending. Light render tests (open shows secret / confirm calls handler). Commit.

### Task 8 — WebhookTable

`DataTableView<WebhookEndpointSummary>`: cols name, url(truncate), status badge, event chips ("All events" for `*`), secretPrefix, created. `rowActions`: Edit (nav), Enable/Disable (update `{enabled:!}` + toast), Test (opens `TestEndpointAction`), Delete (opens dialog). Loading skeleton, illustrated empty (CTA "Create endpoint"), error `Alert`. Uses `useWebhooks` + mutations. Commit.

### Task 9 — TestEndpointAction

Button/menu item → `useTestEndpoint(id)`; on result toast success/failure with status+latency and, if present, a short response snippet; map 409 (no secret) via `apiErrorMessage` to "Add a signing secret before testing." Small inline result surface optional. Commit.

### Task 10 — Pages + routing/registry/nav

`pages/dashboard/settings/webhooks/index.tsx` (SettingsLayout + header + Create link + WebhookTable); `create.tsx` (owns `useCreateWebhook`; on success → open `WebhookSecretModal`, then nav to list); `edit/[id].tsx` (loads via `useWebhook`, seeds `WebhookForm` reset-when-not-dirty; Reveal-secret via `useRevealSecret`→modal; Delete). Wire `routes.ts` (`WEBHOOKS`, `WEBHOOKS_CREATE`, `WEBHOOKS_EDIT`), `registry.ts` (`read-webhooks`/`update-webhooks`), `navigation.ts` (Settings subgroup + icon). Commit.

### Task 11 — Verify + changeset + PR

`pnpm --filter @nextlyhq/admin check-types && lint && test`; `pnpm --filter @nextlyhq/ui test` (contrast). Add one changeset (all pkgs patch) describing the operator-facing capability. Open PR base `main`, trigger `@codex @coderabbitai @greptile-apps`.

## Self-review

- Spec coverage: list/create/edit/enable-disable/delete/secret(once+reveal)/test all mapped to tasks 8/10/8/8/7/6-7/9. ✓
- Types align across tasks (WebhookEndpointSummary, WebhookFormValues, CreateWebhookInput) — defined in Task 1/2, consumed downstream. ✓
- Redaction: header write-only semantics in Task 2 (`toUpdateInput`) + Task 6 (HeadersEditor). ✓
- No placeholders; each task independently testable + committed.
