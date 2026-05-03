# Phase 4.6 — `createSuccessResponse` + `createPaginatedResponse` cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan one sub-PR at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 27 production files away from the legacy `createSuccessResponse` (93 callers) and `createPaginatedResponse` (6 callers) helpers. Replace each call with the appropriate canonical `respondX` helper from `api/response-shapes.ts`. Final cleanup deletes `api/create-success-response.ts` entirely and removes both exports from `api/index.ts`.

**Architecture:** Phase 4 (the main envelope migration) established the canonical wire shapes in spec §5.1: `respondList → { items, meta }`, `respondDoc → T (bare)`, `respondMutation → { message, item }`, `respondAction → { message, ...result }`, `respondData → T (bare)`, `respondCount → { total }`. Pagination meta is `{ total, page, limit, totalPages, hasNext, hasPrev }` — NOT the legacy `{ total, page, perPage }`. Phase 4.6 finishes converting the ~27 endpoints that were out of Phase 4's explicit scope.

**Tech stack:** TypeScript, vitest. No DB or wire-protocol changes beyond response-body shape.

**Out of scope:**

- `schemas/examples.ts:148` — defines its own (unrelated) `createSuccessResponse` for schema examples. Don't touch.
- `domains/email/__tests__/sendlayer-provider.test.ts:35` — defines a local mock helper named `createSuccessResponse` for fetch mocking. Don't touch.

**Branch strategy:** Stack 5 commits on `fix/phase-4-envelope-migration` (one per sub-PR + final cleanup). Push after each commit. No new branches, no separate PRs.

---

## Sub-PR breakdown

| #     | Sub-PR                       | Files                                                    | createSuccessResponse | createPaginatedResponse |
| ----- | ---------------------------- | -------------------------------------------------------- | --------------------- | ----------------------- |
| 4.6a  | Media + Storage + Image      | 6                                                        | 38                    | 3                       |
| 4.6b  | Collections + Singles schema | 6 (incl. 1 new: `singles.ts`)                            | 15                    | 2                       |
| 4.6c  | Components                   | 2                                                        | 5                     | 1                       |
| 4.6d  | Email + Auth + User-Fields   | 12                                                       | 34                    | 0                       |
| Final | Helper deletion              | 1 (`api/index.ts`) + delete `create-success-response.ts` | —                     | —                       |

---

## Per-endpoint migration template

Apply this to EVERY endpoint touched by sub-PRs 4.6a–4.6d. The subagent must read the endpoint to pick the right helper.

### Step 1 — identify the right `respondX` helper

| Endpoint shape today                                                    | Picks                                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Returns `createSuccessResponse(item)` for a get-by-id endpoint          | `respondDoc(item)`                                                                                                                              |
| Returns `createSuccessResponse({ message, item })` for create           | `respondMutation(message, item, { status: 201 })`                                                                                               |
| Returns `createSuccessResponse({ message, item })` for update           | `respondMutation(message, item)`                                                                                                                |
| Returns `createSuccessResponse({ message, id })` for delete-with-no-doc | `respondAction(message, { id })`                                                                                                                |
| Returns `createSuccessResponse({ message, item })` for delete-with-doc  | `respondMutation(message, item)`                                                                                                                |
| Returns `createSuccessResponse({ count })` or count endpoint            | `respondCount(count)` (returns `{ total: count }`)                                                                                              |
| Returns `createSuccessResponse(arrayOrObject)` for non-paginated read   | `respondData(value)`                                                                                                                            |
| Returns `createSuccessResponse(arrayOrObject)` for action               | `respondAction(message, result)`                                                                                                                |
| Returns `createPaginatedResponse(items, { total, page, perPage })`      | `respondList(items, { total, page, limit: perPage, totalPages: Math.ceil(total/perPage), hasNext: page * perPage < total, hasPrev: page > 1 })` |

### Step 2 — apply the migration

```ts
// BEFORE (createSuccessResponse with implicit { data: T } wrap)
import { createSuccessResponse } from "./create-success-response";
return createSuccessResponse({ uploadUrl, expiresIn });

// AFTER (respondData emits T directly, no { data } wrapper)
import { respondData } from "./response-shapes";
return respondData({ uploadUrl, expiresIn });
```

```ts
// BEFORE (createPaginatedResponse emits { data, meta: {total, page, perPage} })
import { createPaginatedResponse } from "./create-success-response";
return createPaginatedResponse(items, { total, page, perPage: limit });

// AFTER (respondList emits { items, meta: {total, page, limit, totalPages, hasNext, hasPrev} })
import { respondList } from "./response-shapes";
const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
return respondList(items, {
  total,
  page,
  limit,
  totalPages,
  hasNext: page < totalPages,
  hasPrev: page > 1,
});
```

### Step 3 — drop the import line if no longer needed

Verify after migration: `grep "create-success-response" packages/nextly/src/api/<file>.ts` should return zero hits in the migrated file.

---

## Sub-PR 4.6a — Media + Storage + Image (38 createSuccessResponse + 3 createPaginatedResponse)

**Files (in dependency order):**

- `packages/nextly/src/api/media-handlers.ts` — 14 createSuccessResponse + 1 createPaginatedResponse
- `packages/nextly/src/api/media-folders.ts` — 8 createSuccessResponse
- `packages/nextly/src/api/media.ts` — 6 createSuccessResponse + 1 createPaginatedResponse
- `packages/nextly/src/api/uploads.ts` — 4 createSuccessResponse + 1 createPaginatedResponse
- `packages/nextly/src/api/image-sizes.ts` — 4 createSuccessResponse
- `packages/nextly/src/api/storage-upload-url.ts` — 2 createSuccessResponse

- [ ] **Step 1: Migrate each file using the per-endpoint template above**

For each file, read every `createSuccessResponse(...)` call and identify the right replacement per the template. The subagent should NOT batch-replace blindly — each call needs judgment.

- [ ] **Step 2: Migrate `createPaginatedResponse` calls**

There are 3 calls in this sub-PR (media-handlers, media, uploads). Apply the per-endpoint template Step 2 (`respondList`).

- [ ] **Step 3: Per-file import cleanup**

After migration of all calls in a file, drop the `import { createSuccessResponse, createPaginatedResponse }` line from that file's imports. Add `respondList`, `respondData`, `respondMutation`, `respondAction`, `respondDoc` etc. as needed.

- [ ] **Step 4: Verify migration is complete in this sub-PR's files**

```bash
grep -n "createSuccessResponse\|createPaginatedResponse" \
  packages/nextly/src/api/media-handlers.ts \
  packages/nextly/src/api/media-folders.ts \
  packages/nextly/src/api/media.ts \
  packages/nextly/src/api/uploads.ts \
  packages/nextly/src/api/image-sizes.ts \
  packages/nextly/src/api/storage-upload-url.ts
```

Expected: zero matches.

- [ ] **Step 5: Admin consumer audit (per Lesson 1)**

The wire shape changed for any endpoint that previously emitted `{ data: ... }` and now emits the bare value or `{ items, meta }`. Run these greps to catch broken admin consumers:

```bash
# Admin sites that read .data when the new wire is bare or { items }
grep -rn "data\.data\b\|data\?\.data\b" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -E "media|upload|storage|image-size|folder"

# Admin sites that read .docs / .totalDocs (legacy paginated)
grep -rn "data\.docs\b\|\.totalDocs\b" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -E "media|upload|storage|image-size|folder"

# Admin sites that read .perPage (the legacy createPaginatedResponse meta field)
grep -rn "\.perPage\b\|meta\.perPage" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -E "media|upload|storage|image-size|folder"
```

Update each broken consumer to read the canonical shape (`.items`, `.meta.limit`, `.meta.total` etc.).

- [ ] **Step 6: Typecheck + tests**

```bash
cd packages/nextly && pnpm exec tsc --noEmit
cd packages/nextly && pnpm vitest src/api/__tests__/response-shapes.test.ts src/api/media-bulk.test.ts src/dispatcher src/domains/media --run
```

Expected: typecheck clean, tests pass (273+ baseline).

```bash
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l
```

Expected: 43 (baseline; zero net-new).

- [ ] **Step 7: Commit + push**

```bash
git add packages/nextly/src/api packages/admin/src
git commit -m "refactor(nextly/api): migrate media + storage + image endpoints to respondX helpers (Phase 4.6a)"
git push origin fix/phase-4-envelope-migration
```

---

## Sub-PR 4.6b — Collections + Singles schema (15 createSuccessResponse + 2 createPaginatedResponse)

**Files:**

- `packages/nextly/src/api/singles-detail.ts` — 4 createSuccessResponse
- `packages/nextly/src/api/singles-schema-detail.ts` — 3 createSuccessResponse
- `packages/nextly/src/api/collections-schema-export.ts` — 3 createSuccessResponse
- `packages/nextly/src/api/collections-schema-detail.ts` — 3 createSuccessResponse
- `packages/nextly/src/api/collections-schema.ts` — 2 createSuccessResponse + 1 createPaginatedResponse
- `packages/nextly/src/api/singles.ts` — 1 createPaginatedResponse (NEW; not in original doc list)

- [ ] **Step 1-4: Apply migration template + verify**

Same as 4.6a Steps 1-4, scoped to these 6 files.

- [ ] **Step 5: Admin consumer audit (per Lesson 1)**

```bash
grep -rn "data\.data\b\|data\?\.data\b\|data\.docs\b\|\.totalDocs\b\|\.perPage\b" \
  packages/admin/src --include="*.ts" --include="*.tsx" \
  | grep -v ".test." | grep -E "singles|collection.*-?schema"
```

- [ ] **Step 6: Typecheck + tests** (same as 4.6a)

- [ ] **Step 7: Commit + push**

```bash
git commit -m "refactor(nextly/api): migrate collections + singles schema endpoints to respondX helpers (Phase 4.6b)"
git push origin fix/phase-4-envelope-migration
```

---

## Sub-PR 4.6c — Components (5 createSuccessResponse + 1 createPaginatedResponse)

**Files:**

- `packages/nextly/src/api/components-detail.ts` — 3 createSuccessResponse
- `packages/nextly/src/api/components.ts` — 2 createSuccessResponse + 1 createPaginatedResponse

- [ ] **Step 1-4: Migrate + verify** (same template)

- [ ] **Step 5: Admin consumer audit**

```bash
grep -rn "data\.data\b\|data\?\.data\b\|data\.docs\b\|\.totalDocs\b\|\.perPage\b" \
  packages/admin/src --include="*.ts" --include="*.tsx" \
  | grep -v ".test." | grep -i "component"
```

Also check the `components.ts` Phase-4 transitional shape per the doc's Tier 1 fold-in note: drop any leftover legacy fallback in this file's admin consumer.

- [ ] **Step 6: Typecheck + tests** (same as 4.6a)

- [ ] **Step 7: Commit + push**

```bash
git commit -m "refactor(nextly/api): migrate component endpoints to respondX helpers (Phase 4.6c)"
git push origin fix/phase-4-envelope-migration
```

---

## Sub-PR 4.6d — Email + Auth + User-Fields (34 createSuccessResponse)

**Files:**

- `packages/nextly/src/api/email-templates-detail.ts` — 4
- `packages/nextly/src/api/email-providers-detail.ts` — 4
- `packages/nextly/src/api/user-fields-detail.ts` — 4
- `packages/nextly/src/api/user-fields.ts` — 3
- `packages/nextly/src/api/email-templates.ts` — 3
- `packages/nextly/src/api/email-templates-layout.ts` — 3
- `packages/nextly/src/api/email-providers.ts` — 3
- `packages/nextly/src/api/user-fields-reorder.ts` — 2
- `packages/nextly/src/api/email-templates-preview.ts` — 2
- `packages/nextly/src/api/email-providers-test.ts` — 2
- `packages/nextly/src/api/email-providers-default.ts` — 2
- `packages/nextly/src/api/auth-state.ts` — 2

- [ ] **Step 1-4: Migrate + verify** (same template)

- [ ] **Step 5: Admin consumer audit**

```bash
grep -rn "data\.data\b\|data\?\.data\b\|data\.docs\b\|\.totalDocs\b\|\.perPage\b" \
  packages/admin/src --include="*.ts" --include="*.tsx" \
  | grep -v ".test." | grep -iE "email|auth-state|user-?field"
```

- [ ] **Step 6: Typecheck + tests** (same as 4.6a)

- [ ] **Step 7: Commit + push**

```bash
git commit -m "refactor(nextly/api): migrate email + auth + user-field endpoints to respondX helpers (Phase 4.6d)"
git push origin fix/phase-4-envelope-migration
```

---

## Final cleanup commit

After all 4 sub-PRs land:

- [ ] **Step 1: Verify zero callers**

```bash
grep -rn "createSuccessResponse\|createPaginatedResponse" packages/nextly/src \
  | grep -v "create-success-response.ts" \
  | grep -v "schemas/examples.ts" \
  | grep -v "domains/email/__tests__/sendlayer-provider.test.ts"
```

Expected: only `api/index.ts:9-10` exports (these are about to be removed).

- [ ] **Step 2: Delete `api/create-success-response.ts`**

```bash
git rm packages/nextly/src/api/create-success-response.ts
```

- [ ] **Step 3: Remove exports from `api/index.ts`**

Drop the `export { createSuccessResponse, createPaginatedResponse, type PaginationMeta } from "./create-success-response";` block. Update the docstring comment at lines 1-5 to drop the reference to these helpers and point at `respondX` helpers instead.

- [ ] **Step 4: Verify no consumers broke**

```bash
cd packages/nextly && pnpm exec tsc --noEmit
cd packages/nextly && pnpm vitest src/api src/dispatcher src/domains/media src/domains/collections --run
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l  # expect 43
```

- [ ] **Step 5: Commit + push**

```bash
git add packages/nextly/src/api/index.ts
git commit -m "chore(nextly/api): delete create-success-response helper after Phase 4.6 migration"
git push origin fix/phase-4-envelope-migration
```

---

## Working conventions per sub-PR (recap from §4 of doc)

- No em dashes in code/comments/commit messages
- No `as any`, `@ts-expect-error`, or `eslint-disable` for type rules
- No backward-compat shims; if you find a transitional fallback, REMOVE it
- Code comments on changes explain WHY, not just WHAT
- Per user memory: NO new tests; only update existing tests that break from the wire-shape change
- NextlyError convention: never throw bare `Error` inside `packages/nextly/**`

## After all 5 commits land

Update `29-phase-4-deferred-tasks-execution-prompt.md`:

- §2 progress table: mark Phase 4.6 ✅ Done with the final commit hash range
- §8 timeline: prepend each commit
- §10 findings log: add an entry per sub-PR if any surprises surfaced

## Self-review checklist

- [x] Every sub-PR file is enumerated by name
- [x] Per-endpoint template covers all 7 known result shapes
- [x] Admin consumer audit (Lesson 1) is a verification gate per sub-PR
- [x] No new test files (per user memory feedback)
- [x] Final cleanup commit deletes the helper file and updates the index export
- [x] Convention reminders attached so subagents don't drift
