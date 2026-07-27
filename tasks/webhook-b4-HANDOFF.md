# Webhook B4 (test-ping + redeliver) — Session Handoff

**Written:** 2026-07-23 (updated 2026-07-24). **PR:** https://github.com/nextlyhq/nextly/pull/310
**Status:** OPEN, CI all green, mergeable but merge-BLOCKED pending codex APPROVED. **0 open review threads** as of last check.

**Latest HEAD:** `c0bc7bea` (round 6 — 404 unknown endpoint id on redelivery; round 5 = finalize lease fence). The §7 "Expired worker clobbers redelivery" thread is RESOLVED (fixed in `3fb4da1f`, see §6 round 5).

---

## 0. TL;DR — where to pick up

1. **Immediate:** re-check open review threads (GraphQL in §8). If codex/greptile/coderabbit posted a new round on `3fb4da1f`, work it with a proper solution. If none and codex has APPROVED, tell the founder it's ready and WAIT for the explicit go-ahead.
2. Keep babysitting #310: work each new review round with a _proper_ solution, push, reply+resolve, re-trigger `@codex @coderabbitai @greptile-apps`.
3. **Do NOT merge** until (a) codex posts an APPROVED review AND (b) the founder gives an explicit per-PR go-ahead. Both are required. Codex approval alone is not enough.
4. After #310 merges → **U1** (admin webhooks UI), then **B5** (webhook secret rotation). See §9.

---

## 1. Standing directives (from the founder — treat as law)

- **Prime directive:** "work properly on all the priority order tasks after full in-depth deep research for best architecture, best industry standards, best dx/ux/ui." Latest = deep, correct solutions, not quick patches.
- **Scope:** "you are only responsible for your PRs" — only the webhook PRs I authored. Don't wander into unrelated work.
- **Review triggers:** on every push of new commits, post one comment tagging **`@codex @coderabbitai @greptile-apps`** to request re-review.
- **Merge gate:** "Once codex approves these PRs, then we can only merge." Combined with the hard rule: **never merge without an explicit founder go-ahead for that specific PR**, even after codex approves. I have broad permissions but this gate is absolute.
- **Review loop:** keep a ~15-min watcher on the PR; fetch unresolved threads; fix real issues with proper solutions + tests; push back with evidence on false positives; reply to and resolve every thread so bots re-verify.

### Conventions (enforced; violations rejected in review — see AGENTS.md)

- `NextlyError` factories only inside `packages/nextly/**` (never bare `Error`). Admin is exempt.
- **Drizzle ORM only**, no raw SQL in product code. Test fixtures use production DDL helpers (drizzle-kit), never hand-copied CREATE TABLE.
- **No `as any` / `@ts-expect-error` / eslint-disable.** Fix with real types/guards/generics.
- API responses use `response-shapes.ts` envelopes (`{items,meta}` / `{message,item}`). Never invent a shape.
- Every code change gets a **what/why comment**. Comments describe the code ONLY — never reference tasks, plans, PRs, reviews, or findings.
- **ONE changeset per PR**, all 18 published packages, `patch` (alpha, lockstep). Test/CI/docs-only PRs get none.
- **Conventional Commits** (`type(scope): subject`, lowercase imperative). Valid scopes are package names + `playground|root|ci|docs|deps|release`. `nextly` is the scope used here.
- **No AI attribution** anywhere (no Co-Authored-By, no "Generated with Claude").
- Never `--no-verify`. Husky runs gitleaks + lint-staged + commitlint on commit; lint+build on push. Fix hook failures, don't bypass.

---

## 2. Locations / coordinates

- **Worktree:** `/Users/mobeen/Work/Products/nextly-integrations/nextly/nextly-worktrees/webhook-b4`
- **Branch:** `feat/webhook-test-redeliver` (base `main`).
- **Monorepo root** (for integration tests): `/Users/mobeen/Work/Products/nextly-integrations/nextly` (the worktree shares the same pnpm workspace; run integration from the worktree root which resolves to the workspace).
- **Watcher task id:** `b53708drl` (persistent Monitor, 15-min poll of #310 for unresolved threads / CI fails / codex approval / merge-close). It has survived the whole session; a re-armed one is fine if it's gone.
- **Repo:** `nextlyhq/nextly` (private). `gh` CLI is authenticated.

### Commits on the branch (newest first)

```
c0bc7bea fix(nextly): 404 an unknown endpoint id on redelivery         <- round 6
3fb4da1f fix(nextly): fence delivery finalize on lease ownership        <- round 5
3e8e3eec fix(nextly): lock the drain claim against a redelivery re-arm
e933386c fix(nextly): probe with the durable drain timeout
f16f7b35 fix(nextly): re-arm webhook delivery under a row lock
10d9b464 fix(nextly): guard webhook redelivery against active leases
a3e6df85 feat(nextly): add webhook endpoint test-ping and delivery redeliver   <- original B4
```

Main was at `a3e6df85`'s parent when branched. Prior webhook PRs **#301 and #307 are already MERGED** to main.

---

## 3. What B4 is (the feature)

Two new REST endpoints on the webhooks surface, both requiring the webhook **update** permission and an **interactive session** (session-only, no route/bearer):

1. **`POST /api/webhooks/:id/test`** — a pure connectivity probe ("test-ping").
   - Builds a synthetic `webhook.ping` payload (NOT a real `WebhookEvent` — distinct shape, no event-catalog pollution), signs it with the endpoint's real secret using the exact Standard-Webhooks signing the delivery engine uses, POSTs it via the same SSRF-safe transport.
   - **Writes nothing** to `nextly_events` or `nextly_webhook_deliveries` — no outbox row, no delivery-log row, no fan-out, no retry.
   - Returns inline: `{ delivered, statusCode?, latencyMs, error?, responseSnippet? }`. Never throws for a failed delivery (returns `delivered:false`).
   - Works on a disabled endpoint too (verify a receiver before enabling). 409 if the endpoint has no signing secret.

2. **`POST /api/webhooks/:id/deliveries/:deliveryId/redeliver`** — re-send a past delivery.
   - The unique `(webhook_id, event_id)` index forbids a second delivery row, so this **re-arms the existing row** (resets it to `pending`, `next_attempt_at=now`, `attempt_count=0`, lock cleared) while keeping the capped `attempts[]` history. Reuses the delivery id (the Standard-Webhooks `webhook-id`), so a receiver that already processed it dedupes.
   - Nudges the fast drain so it goes out promptly; the outcome then shows in the delivery log.
   - **Guards:** 404 unknown/foreign delivery; 409 if endpoint deleted or disabled; **409 if the delivery is still in flight** (held under an unexpired lease).

---

## 4. Files in the PR

**New:**

- `packages/nextly/src/domains/webhooks/test-endpoint.ts` — pure probe. Exports `runEndpointProbe(input)`, `WebhookPingPayload`, `WebhookTestResult`, `EndpointProbeInput`. Custom headers first, signature headers LAST (so signature can't be shadowed). Probe timeout = `DRAIN_REQUEST_TIMEOUT_MS` (10s, imported from deliver.ts — see §6 decisions).
- `packages/nextly/src/domains/webhooks/__tests__/webhook-test-redeliver.integration.test.ts` — real SQLite (in-memory) suite. Manual adapter wiring (`createSqliteAdapter` + drizzle-kit DDL + seeded user). Covers: probe signs validly + persists nothing + 10s timeout + non-2xx/throw/404; redeliver re-arms + budget reset + history kept + unique-index + in-flight-lease refusal + pruned-event-cascade 404 + 404 unknown + 409 disabled + foreign-delivery rejection. **11 redeliver + test-ping cases.**
- `.changeset/webhook-test-redeliver.md` — all 18 packages, patch.
- `tasks/webhook-b4-test-redeliver-spec.md` — the B4 spec (local, uncommitted).

**Modified:**

- `packages/nextly/src/domains/webhooks/services/webhook-endpoint-service.ts` — `testEndpoint(id, opts?)` and `redeliverDelivery(webhookId, deliveryId)`. redeliver runs the read-guard-write in a **transaction with `SELECT ... FOR UPDATE`** (§6).
- `packages/nextly/src/domains/webhooks/deliver.ts` — exported `DRAIN_REQUEST_TIMEOUT_MS = 10_000`; `claimDelivery` SELECT now uses `forUpdate: true` (§6/§7). `DEFAULT_REQUEST_TIMEOUT_MS` (15s) is back to a private fallback.
- `packages/nextly/src/api/webhooks.ts` — `testWebhookEndpoint` + `redeliverWebhookDelivery` handlers (update perm + session-only + envelopes). Drain route imports `DRAIN_REQUEST_TIMEOUT_MS` from deliver.ts (was a local const).
- `packages/nextly/src/errors/nextly-error.ts` — `conflict()` gained an optional `message` for domain-specific state conflicts (default message unchanged).
- `packages/nextly/src/route-handler/route-parser.ts` + `routeHandler.ts` — parse/dispatch the two new routes.
- `packages/nextly/src/api/webhooks.test.ts` + `route-handler/__tests__/route-parser.webhooks.test.ts` — unit coverage for handlers + route parsing.

---

## 5. Webhook architecture context (enough to reason about the reviews)

Content write → `recordMutationEvent` (writes `nextly_events` outbox) → `fanOut` (`selectDeliveryTargets`) → `deliver` (Standard-Webhooks HMAC signing, SSRF-safe `safeFetch`, at-least-once + receiver dedup) → `runWebhookDrain` + `WebhookFastDrainScheduler` (Next.js `after()` post-response fast path).

**Three tables** (per-dialect schemas in `packages/nextly/src/schemas/webhooks/{sqlite,pg,mysql}.ts`):

- `nextly_events` — outbox.
- `nextly_webhooks` — endpoints. `secret_hash` = JSON array of AES-GCM ciphertexts (list-shaped for rotation). `deleted_at` soft-delete.
- `nextly_webhook_deliveries` — per-endpoint retry state. UNIQUE `(webhook_id, event_id)`. `event_id` FK **`onDelete: cascade`**, `webhook_id` FK cascade. `status` ∈ pending/processing/delivered/retrying/failed. `attempt_count`, `next_attempt_at`, `locked_by`/`locked_until` (lease), `attempts[]` capped at 20.

**Drain concurrency model (critical for the reviews):**

- `claimDelivery(id, runnerId, now, leaseMs)` runs a transaction: SELECT the row (now `forUpdate:true`), check `isDue` (pending/retrying + next_attempt_at ≤ now) and `leaseFree` (locked_until null or ≤ now), then UPDATE the lease (`locked_by`, `locked_until`) keyed by id. Returns the in-memory row.
- Drain loop: `attemptCount = row.attemptCount + 1`; `attemptDelivery(...)` signs+sends, then `finalizeDelivery` writes the outcome and clears the lease **UNCONDITIONALLY keyed by id** (this is the crux of the open thread §7).
- **Real per-request timeouts:** cron/manual drain route passes `DRAIN_REQUEST_TIMEOUT_MS` (10s); fast-path scheduler (`after-drain.ts`) passes `4_000` (4s). `DEFAULT_REQUEST_TIMEOUT_MS` (15s) is only a library fallback the product never uses.

**Retention:** `prune.ts` deletes aged rows from `nextly_events` (cascade removes their deliveries) and old `nextly_webhook_deliveries`. It builds a `blocked` set so it never prunes an event that still has a live delivery. ⇒ a delivery referencing a pruned/unusable event **cannot exist** (this is why the "pruned event" review was a false positive — see §6).

**Adapter facts learned this session:**

- Where-clause DSL uses **JS property names** (camelCase: `webhookId`, `lockedUntil`), not DB column names. Ops include `=`, `<=`, `IS NULL`, `or`, `and`.
- UPDATE `data` object keys are snake_case (mapped internally); WHERE columns are camelCase.
- `adapter.select`/`executeQuery` return arrays directly (NOT `{rows}`).
- **`forUpdate: true`** on a SELECT takes a `FOR UPDATE` row lock; **no-op on SQLite** (its transactions open `BEGIN IMMEDIATE`, already serializing writers), correct `FOR UPDATE` on pg/mysql. Requires a transaction executor. Already used by single/collection mutation services with adapter test coverage — a trusted pattern.
- SQLite `integer{mode:"timestamp"}` stores **Unix seconds**. FK cascades enforced (`PRAGMA foreign_keys = ON` by default).
- `NextlyError.conflict()` originally had only `{reason?, logContext?}` with a fixed generic message. This PR added an optional `message`.

---

## 6. Review rounds worked + every decision (chronological)

**Round 1 → commit `10d9b464`:**

- _Lease revocation (greptile ×2 + codex P1):_ redeliver unconditionally cleared an active lease → concurrent drain could double-send. **Fixed** (first pass): refuse in-flight lease + conditional update.
- _Probe timeout 10s vs 15s (greptile P2):_ aligned probe to the delivery timeout. **(Later corrected — see round 3.)**
- _Use NextlyError factories (codex P1):_ extended `conflict()` with optional `message`; routed all four CONFLICT throws through it. Status still derives centrally from the code. **Fixed.**
- _Endpoint guard races with rearm (greptile P1):_ **false positive** — `attemptDelivery` re-loads the endpoint at send time and fails deliveries for deleted/disabled endpoints, so a re-armed row is never POSTed to a retired endpoint. Pushed back with evidence.

**Round 2 → commit `f16f7b35`:**

- _False success on lost race (greptile ×2 + codex + coderabbit):_ the conditional UPDATE discarded its result, so on the race the API still said "queued." **Fixed properly:** reworked redeliver into a **transaction with `SELECT ... FOR UPDATE`** — the row lock closes the read/claim interleave; the pre-write SELECT determines the outcome (in-flight → 409, success only after the row is actually armed). Replaced the affected-count-guessing approach. Added the in-flight-lease integration test.
- _Pruned-event 409 (coderabbit Major):_ **false positive** — `event_id` cascades + retention's blocked-set mean a delivery for a pruned event can't exist → 404. Pushed back AND added a defensive test (`404s when the delivery's event was pruned`) proving the cascade invariant.

**Round 3 → commit `e933386c`:**

- _Probe timeout vs REAL drain timeouts (codex P2):_ codex was sharper than round-1 greptile — the product drain uses 10s (cron) / 4s (fast), not 15s. My 15s was too lenient (false positives). **Fixed:** probe now waits `DRAIN_REQUEST_TIMEOUT_MS` (10s, the durable path). Moved the constant into deliver.ts as the single source; drain route + probe both import it. Added a test asserting the probe issues a 10s timeout. (Reverted the round-1 export of `DEFAULT_REQUEST_TIMEOUT_MS`.)

**Round 4 → commit `3e8e3eec`:**

- _Stale drain claim after re-arm (codex P2):_ `claimDelivery` SELECT lacked a row lock and cached `attemptCount` in memory; on pg/mysql it could claim a row my re-arm just reset and act on the stale budget (line `attemptCount = row.attemptCount + 1`). **Fixed:** added `forUpdate: true` to `claimDelivery`'s SELECT so claim and re-arm serialize on the row (no-op on SQLite). Follows the existing forUpdate pattern.

**Round 5 → commit `3fb4da1f`:**

- _Expired worker clobbers redelivery (greptile P1):_ a worker that overruns its lease (lease expired but HTTP still in flight) could `finalizeDelivery` by id and overwrite a row a re-arm/other-drain had taken over. **Fixed:** `claimDelivery` stamps the runner as lease owner on the returned row (`row.lockedBy = runnerId`, plus `lockedBy` added to the `DeliveryRow` interface); `finalizeDelivery` fences its UPDATE with `AND locked_by = row.lockedBy`, so a handed-off row's stale finalize is a no-op. Closes the same clobber between two drain workers too. Deterministic test in `deliver.integration.test.ts` (`does not clobber a delivery whose lease was handed off mid-attempt`) steals the lease during the in-flight request and asserts the re-armed row survives.

**Round 6 → commit `c0bc7bea`:**

- _Unknown endpoint id returned 409 instead of 404 (codex P2):_ the endpoint check ran before the scoped delivery lookup, and `getEndpoint` returns null for both a missing and a soft-deleted endpoint, so a mistyped `webhookId` got a bogus "endpoint deleted" 409. **Fixed:** reordered so the `FOR UPDATE` delivery lookup runs first (unknown/foreign/bogus id → 404), then the endpoint row is read in the same transaction and its `deleted_at`/`enabled` distinguish deleted (409) from disabled (409). A delivery outlives its endpoint's soft-delete (tombstone only cancels queued rows), so the deleted branch stays reachable. Two tests added.

All six rounds: check-types + lint clean, full webhook integration suite green (533 passed on SQLite locally as of `c0bc7bea`; CI runs pg/mysql/sqlite legs). Every thread replied + resolved.

---

## 7. Resolved thread (was "do this first")

**greptile P1 "Expired worker clobbers redelivery"** — RESOLVED in `3fb4da1f` (see round 5 above). Kept here for context in case it re-opens on re-review.

**greptile P1 "Expired worker clobbers redelivery"** — `webhook-endpoint-service.ts:672`, thread id `PRRT_kwDOSYwUJs6TVcjH`, comment db id `3640231506`. Landed 2026-07-23T17:51Z (after `3e8e3eec`).

**The claim:** if a drain worker's lease _expires_ while it is still actually processing (slow HTTP), my re-arm sees `locked_until ≤ now` (treats it as idle) and re-arms to `pending`. The still-running original worker then calls `finalizeDelivery`, whose UPDATE is **unconditional by id**, and overwrites the fresh `pending` state with the old attempt's outcome. API said "queued," but the redelivery is silently clobbered.

**My analysis:** this is REAL but it is a property of the drain's lease-expiry + unconditional-finalize design, not something redeliver invented — the _same_ clobber happens if an expired lease is reclaimed by a second drain worker. The clean, canonical fix is a **fencing check on `finalizeDelivery`**: scope its UPDATE to `WHERE id = ? AND locked_by = <this runnerId>`. Then a worker whose lease was stolen (by another drain, or by a re-arm which sets `locked_by = null`) matches zero rows and its stale outcome is dropped.

**Recommended implementation:**

- `finalizeDelivery(deps, row, now, update)` → also thread the current `runnerId` (available in the drain loop / `deps.runnerId`) and add `locked_by = runnerId` to its WHERE `and[]`. (The claimed `row.lockedBy` is the pre-claim value, so use the runnerId this worker set, not `row.lockedBy`.)
- Consider the same fencing on `recoverUnexpectedFailure`'s finalize path.
- Verify: an expired-lease worker finalizing after a re-arm (locked_by cleared) is a no-op; a normal finalize (worker still owns the lease) still writes.
- This touches the core drain finalize path (affects all deliveries), so run the full webhook integration suite. Add a test if it can be made deterministic (SQLite forUpdate no-ops, so a true two-connection race is hard — a targeted test that calls finalize with a mismatched runnerId and asserts no write is the pragmatic version).
- **Alternative framing if pushing back:** it's a pre-existing at-least-once property mitigated by receiver-side dedup (stable webhook-id). But given the founder wants proper solutions and the fix is small + canonical, **implement the fence** rather than argue.

**Workflow to close it:** fix → `pnpm check-types` + `pnpm lint` (in `packages/nextly`) → run webhook integration (§8) → commit (`fix(nextly): ...`) → push → reply on the thread with the commit sha + what/why → resolve the thread → comment `@codex @coderabbitai @greptile-apps please re-review`.

---

## 8. How to test (learned the hard way)

- **Type/lint** (fast, no build): in `packages/nextly`: `pnpm check-types` and `pnpm lint`.
- **Unit** (source, fast): `pnpm vitest run <paths>` from `packages/nextly`. Key files: `src/api/webhooks.test.ts`, `src/route-handler/__tests__/route-parser.webhooks.test.ts`, `src/errors`.
- **Integration** (needs built deps): run from the **worktree root**, NOT `--filter` on an unbuilt tree. Command used all session:
  `pnpm --filter nextly test:integration -- webhook` (turbo builds deps first; SQLite in-memory; ~4 min). It self-skips pg/mysql when `TEST_*_URL` unset. The redeliver suite runs green at **530 passed / 82 skipped** on SQLite.
- Integration runs take >120s → they get backgrounded; use a Monitor `until grep -qE "Test Files|failed|Error:" file; do sleep 3; done` to wait.
- CI matrix (pg15/pg17/mysql/sqlite) runs on push — covers the `FOR UPDATE` legs that no-op locally on SQLite. Don't block on CI locally; the watcher/CI reports it.
- **Baseline caveat:** the repo has ~412 pre-existing stale-mock unit failures unrelated to this work. Never add to it; only care about the areas you touch.

### Fetch unresolved review threads (the GraphQL that worked)

```bash
gh api graphql -f query='
query { repository(owner:"nextlyhq",name:"nextly"){ pullRequest(number:310){
  reviewThreads(first:90){ nodes{ id isResolved path line
    comments(first:1){nodes{databaseId author{login} body createdAt}} } } } } }' \
| python3 -c 'import json,sys,re
d=json.load(sys.stdin)
for t in d["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]:
    if t["isResolved"]: continue
    c=t["comments"]["nodes"][0]; b=re.sub(r"<details>.*?</details>","[..]",c["body"],flags=re.S)
    print(t["id"], c["databaseId"], c["author"]["login"], t["path"], t.get("line")); print(b[:1600]); print()'
```

### Reply + resolve a thread

```bash
gh api repos/nextlyhq/nextly/pulls/310/comments/<DB_ID>/replies -f body="<reply>"
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t="<THREAD_ID>"
```

---

## 9. Remaining tasks / queue

1. **#310 to merge-ready:** close the open thread (§7) + any further rounds. Then **wait for codex APPROVED + explicit founder go-ahead** before merging (`gh pr merge 310 --repo nextlyhq/nextly --squash --admin` only when both are satisfied).
2. **U1 — admin webhooks UI** (next feature): manage endpoints (create/edit/enable/disable/delete), delivery log view, and **Test** + **Redeliver** buttons wired to the two B4 endpoints. Token-driven styling, both light/dark, `--nx-*` only. New worktree/branch off main.
3. **B5 — webhook secret rotation** (overlap window): `secret_hash` is already list-shaped for exactly this; add a rotate action that appends a new secret and retires the old after an overlap.

### Deferred follow-ups (already logged to memory, not part of #310)

- Content-addressed media variant paths [from #307].
- Persist localized field defaults to the companion on auto-create [#301].
- Reconcile default-locale companion `_status` consistency [#301].
- (Webhooks program, separate) admin webhooks UI = U1 above; capture coverage gaps (no delete/singles/status events) tracked in memory `project_webhooks_audit_2026_07_21`.

---

## 10. Broader webhook program state (from memory)

The webhook **engine is real and solid** (outbox + signing + fan-out + deliver + retry + drain + retention all shipped across #290/#301/#307 and earlier). The **product surface** is what's being built out now, in small PRs: B4 (test/redeliver) = this PR; U1 (admin UI) and B5 (rotation) next. Order chosen: secret crypto → CRUD → drain → events → operator actions (test/redeliver) → UI → rotation. Relevant memory files: `project_webhooks_events_research`, `project_webhook_outbox_gate`, `project_webhooks_audit_2026_07_21`, `project_webhook_recording_followups`, `project_priority_roadmap`.
