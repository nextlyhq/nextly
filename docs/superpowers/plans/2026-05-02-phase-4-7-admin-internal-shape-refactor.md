# Phase 4.7 — admin internal shape refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the admin's legacy `TableResponse<T>` / `PaginatedDocs<T>` shapes and the `normalizePagination` helper. After this phase, admin services pass the canonical `ListResponse<T>` (`{ items, meta }` per spec §5.1) straight through; every hook + component reads `.items` and `.meta.{total,page,limit,totalPages,hasNext,hasPrev}`.

**Architecture:** Phase 4 introduced the canonical wire shape but left admin services adapting it back to the legacy `TableResponse { data, meta: {page, pageSize, total, totalPages} }`. Phase 4.7 collapses the adapter layer.

```
BEFORE
server emits { items, meta }
  → fetcher returns { items, meta }
  → admin service ADAPTS to TableResponse { data, meta }   (REMOVE THIS)
  → hook returns TableResponse to component
  → component reads response.data and response.meta.pageSize

AFTER
server emits { items, meta }
  → fetcher returns { items, meta }
  → admin service passes through (ListResponse)
  → hook returns ListResponse to component
  → component reads response.items and response.meta.limit
```

**Tech stack:** TypeScript, React, vitest. No DB or wire changes.

**Branch strategy:** Stack 2 commits on `fix/phase-4-envelope-migration`:

- 4.7a: type renames + service updates (intentionally breaks all consumers at compile time)
- 4.7b: hook + component fixes (resolves every TS error from 4.7a)

**Per user memory:** NO new tests. Only update existing tests that break from the type rename.

---

## Scope inventory

**Type definitions to change:**

- `packages/ui/src/types/table.ts:29` — rename `TableResponse<TData>` → `ListResponse<TData>`, change field `data` → `items`, swap meta to canonical `PaginationMeta` (`{total, page, limit, totalPages, hasNext, hasPrev}`)
- `packages/ui/src/types/table.ts:2-7` — drop the local `PaginationMeta` definition (uses legacy `pageSize` field). Re-export the canonical one or import from `@admin/lib/api/response-types`.
- `packages/ui/src/types/table.ts:22-26` — `TableParams.pagination` field name decision. The `pageSize` here is admin-internal React state (the user's chosen page-size from the dropdown). Keep as `pageSize` (since the field semantics differ from wire `limit`). Document why inline.

**Files renamed via find/replace (`TableResponse` → `ListResponse`):** ~22 files (per audit)

**Files dropped:**

- `packages/admin/src/lib/api/normalizePagination.ts` (admin-internal helper, no longer needed)
- `packages/admin/src/services/entryApi.ts:37` (`PaginatedDocs<T>` interface, replaced by canonical `ListResponse<Entry>`)
- `packages/admin/src/services/entryApi.ts:219-226` (`buildPaginatedDocs<T>` function)

**Admin services to simplify (drop adapter step):**

- `componentApi.ts`, `permissionApi.ts`, `userApi.ts`, `entryApi.ts`, `collectionApi.ts`, `singleApi.ts`, `roleApi.ts` — each currently does `{ data: response.items, meta: normalizePagination(response.meta, ...) }`. After 4.7, just pass `response` through.

**Hooks updated:**

- `useUsers`, `useRoles`, `useCollections`, `useSingles`, `useComponents`, `usePermissions`, `useEntries` — TypeScript generic changes from `TableResponse<T>` to `ListResponse<T>`

**Components updated (3 reads of `.data`):**

- `EntryList/EntryList.tsx` — converts `PaginatedDocs` to `EntryTablePagination` format; rewrite to consume `ListResponse`
- `entries/fields/relational/JoinField.tsx` — reads paginated entry data
- `entries/fields/relational/RelationshipSearch.tsx` — reads paginated entry data

**DataTable / useServerTable adaptation:**

- `useServerTable.ts:244` — `setServerData(response.data)` → `setServerData(response.items)`
- `useServerTable.ts:245` — `setPaginationMeta(response.meta)` — meta shape changes from `{page, pageSize, total, totalPages}` to canonical. Internal state name `currentPageSize` stays (admin-internal React state name; rename out of scope).

---

## Task 1 — Phase 4.7a: type renames + service updates (one commit)

**Files:**

- Modify: `packages/ui/src/types/table.ts` (type def + re-exports)
- Modify: `packages/ui/src/index.ts` (re-export site)
- Modify: 7 admin services (`componentApi, permissionApi, userApi, entryApi, collectionApi, singleApi, roleApi`)
- Modify: `packages/admin/src/hooks/useServerTable.ts` (response.data → response.items)
- Delete: `packages/admin/src/lib/api/normalizePagination.ts`
- Modify: `packages/admin/src/services/entryApi.ts` (drop `PaginatedDocs`, `buildPaginatedDocs`)

- [ ] **Step 1: Rename `TableResponse` → `ListResponse` in `packages/ui/src/types/table.ts`**

```ts
// BEFORE (lines 1-32)
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TableResponse<TData> {
  data: TData[];
  meta: PaginationMeta;
}

// AFTER (canonical wire shape per spec §5.1)
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ListResponse<TData> {
  items: TData[];
  meta: PaginationMeta;
}
```

`TableParams.pagination` keeps `pageSize` as the admin-internal React state name (the user's selected dropdown value). Document this inline:

```ts
export interface TableParams {
  pagination: {
    page: number;
    /**
     * Admin-internal React state: the user's selected page-size dropdown
     * value. Maps to wire `limit` when the fetcher builds the request.
     * Renaming this admin-internal field is out of Phase 4.7 scope.
     */
    pageSize: number;
  };
  sorting?: SortInfo[];
  filters?: FilterInfo;
}
```

- [ ] **Step 2: Update `packages/ui/src/index.ts`**

```ts
// BEFORE
export type {
  ...
  TableResponse,
  ...
};

// AFTER
export type {
  ...
  ListResponse,
  ...
};
```

`DataFetcher<TData>` already returns the renamed type signature (line 50-52):

```ts
export type DataFetcher<TData> = (
  params: TableParams
) => Promise<ListResponse<TData>>;
```

- [ ] **Step 3: Rename in `useServerTable.ts:244-245`**

```ts
// BEFORE
const response = await fetcher(params);
setServerData(response.data);
setPaginationMeta(response.meta);

// AFTER
const response = await fetcher(params);
setServerData(response.items);
setPaginationMeta(response.meta);
```

The `paginationMeta` state shape now uses canonical fields. Update local state typing if it referenced the old `PaginationMeta`. In the rest of `useServerTable`, anywhere that reads `paginationMeta.pageSize` becomes `paginationMeta.limit`.

- [ ] **Step 4: Update 7 admin services to pass through (drop adapter)**

For each of `componentApi, permissionApi, userApi, entryApi, collectionApi, singleApi, roleApi`:

```ts
// BEFORE (typical adapter)
const result = await fetcher<ListResponse<X>>(
  `/admin/api/...?${query}`,
  {},
  true
);
const { pageSize = 10 } = params.pagination;
const items = result.items ?? [];
const meta = normalizePagination(result.meta, pageSize, items.length);
return { data: items, meta };

// AFTER (pass-through)
const result = await fetcher<ListResponse<X>>(
  `/admin/api/...?${query}`,
  {},
  true
);
return result;
```

`buildQuery` keeps emitting `?limit=` per Phase 4.8.

- [ ] **Step 5: Delete `packages/admin/src/lib/api/normalizePagination.ts`**

```bash
git rm packages/admin/src/lib/api/normalizePagination.ts
```

Verify zero remaining imports:

```bash
grep -rn "normalizePagination\|NormalizedPagination" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Expected: zero matches after step 4 lands.

- [ ] **Step 6: Drop `PaginatedDocs<T>` + `buildPaginatedDocs` from `entryApi.ts`**

Replace `PaginatedDocs<Entry>` return type with `ListResponse<Entry>`. Replace `buildPaginatedDocs(docs, meta)` calls with the canonical `{ items: docs, meta }` shape. Drop the `PaginatedDocs` interface (entryApi.ts:37) and `buildPaginatedDocs` function (entryApi.ts:219-226).

- [ ] **Step 7: Update `EntryList`, `JoinField`, `RelationshipSearch` consumers**

These read `data.docs` / `.totalDocs` (legacy PaginatedDocs shape):

- `EntryList/EntryList.tsx:71` — `response: PaginatedDocs | undefined` → `response: ListResponse<Entry> | undefined`. Inside, `.docs` → `.items`, `.totalDocs` → `.meta.total`.
- `JoinField.tsx`, `RelationshipSearch.tsx` — same pattern.

- [ ] **Step 8: Verify the diff doesn't introduce em dashes**

```bash
git diff packages/ui packages/admin/src 2>&1 | grep -E "^\+" | grep "—"
```

Expected: zero matches.

- [ ] **Step 9: Build + typecheck**

```bash
pnpm --filter @revnixhq/ui build
pnpm --filter @revnixhq/nextly build  # refresh dist for admin to consume
cd packages/nextly && pnpm exec tsc --noEmit  # must be clean
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l
```

The admin typecheck count after 4.7a will be HIGHER than 43 baseline (intentional — 4.7b fixes them). Record the count for tracking.

- [ ] **Step 10: Commit (DO NOT push yet — branch is intentionally red until 4.7b)**

```bash
git add packages/ui packages/admin/src
git commit -m "refactor(admin/ui): rename TableResponse to ListResponse + drop adapter layer (Phase 4.7a)"
```

---

## Task 2 — Phase 4.7b: hook + component fixes (one commit)

Goal: drive admin typecheck back to baseline (43 errors).

- [ ] **Step 1: Rename `TableResponse` → `ListResponse` in remaining type annotations**

```bash
grep -rln "TableResponse" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

For each file: replace `TableResponse<X>` type annotation with `ListResponse<X>` and update import sources (`@revnixhq/ui` if from there, `@admin/lib/api/response-types` otherwise).

Hooks affected (~6): `useUsers, useRoles, useCollections, useSingles, useComponents, usePermissions`. Update generic params on `useQuery<ListResponse<T>, Error>` and `UseQueryOptions`.

- [ ] **Step 2: Test files**

Tests that import `TableResponse` and synthesize fake responses need their fixture data renamed: `data: [...]` → `items: [...]`. Files:

- `packages/admin/src/components/ui/table/DataTable.test.tsx`
- `packages/admin/src/__tests__/helpers/table.ts`
- `packages/admin/src/hooks/useServerTable.test.ts`

Per user memory: do NOT add new tests. Just update existing fixtures.

- [ ] **Step 3: Components reading `.data` from query result**

Audit:

```bash
grep -rn "\.data\.data\|users\.data\|roles\.data\|collections\.data\|singles\.data\|components\.data\|permissions\.data\|entries\.data" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

For each component-level read of `<query-result>.data` (the legacy TableResponse field): change to `.items`.
For each component-level read of `meta.pageSize` from a fetched response: change to `meta.limit`.
For each component-level read of `meta.totalDocs`: change to `meta.total`.

- [ ] **Step 4: Verify no em dashes**

```bash
git diff packages/admin/src 2>&1 | grep -E "^\+" | grep "—"
```

- [ ] **Step 5: Verify typecheck back to baseline**

```bash
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l
```

Expected: 43 (the documented baseline).

- [ ] **Step 6: Run nextly + admin tests**

```bash
cd packages/nextly && pnpm vitest src/api src/dispatcher src/domains/media src/domains/collections --run  # must pass
pnpm --filter @revnixhq/admin test --run 2>&1 | tail -10  # baseline pass count must hold
```

- [ ] **Step 7: Commit + push BOTH commits together**

```bash
git add packages/admin/src
git commit -m "refactor(admin): consume canonical ListResponse end-to-end (Phase 4.7b)"
git push origin fix/phase-4-envelope-migration
```

(Push lands BOTH 4.7a and 4.7b at once so origin never sees a red branch.)

---

## Working conventions (recap from §4 of doc)

- No em dashes anywhere; replace with periods, semicolons, parens.
- No `as any`, `@ts-expect-error`, `eslint-disable` for type rules.
- Comments explain WHY (not WHAT).
- No new test files (per user memory).
- Run `pnpm --filter @revnixhq/nextly build` before measuring admin typecheck baseline (per Lesson 10).

## After both commits land

Update `29-phase-4-deferred-tasks-execution-prompt.md`:

- §2 progress table: mark Phase 4.7 ✅ Done with commit hashes
- §8 timeline: prepend the two commits
- §10 findings log: add an entry covering the actual blast radius vs estimate

## Self-review checklist

- [x] All ~22 files with `TableResponse` enumerated
- [x] `PaginatedDocs<T>` deletion path covered (interface + buildPaginatedDocs function + 5 consumer files)
- [x] `normalizePagination` deletion path covered (helper + 7 consumers)
- [x] `TableParams.pagination.pageSize` admin-internal field intentionally NOT renamed
- [x] Two-commit strategy: 4.7a deliberately breaks compile, 4.7b drives back to baseline
- [x] Single push at the end so origin never sees red
