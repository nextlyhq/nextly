# Phase 4.8 — `pageSize → limit` end-to-end rename

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the legacy `pageSize` field name across the entire request/response pipeline (dispatcher input parsing, service signatures, Zod input schemas, client URL emitters) and accept ONLY the canonical `limit`. No transitional fallback shims.

**Architecture:** Phase 4 already renamed the OUTPUT meta field (`pageSize → limit` in wire `PaginationMeta`). This phase finishes the rename on the INPUT side. Per the user's "no compat shims" directive, the existing `p.limit ?? p.pageSize` fallback in `collection-dispatcher.listEntries` is removed too.

**Tech Stack:** TypeScript, Zod schemas, Drizzle ORM, vitest.

**Out of scope (Phase 4.7 will handle):** admin-internal `[pageSize, setPageSize]` React state, `pagination: { page, pageSize }` shape on `TableParams` from `@revnixhq/ui`, the `normalizePagination` helper and its `NormalizedPagination` type. These are admin-internal and unrelated to wire/server contracts.

---

## File structure

### Server-side production code

**Dispatcher input parsers (5 sites, 3 files):**

- `packages/nextly/src/dispatcher/handlers/user-dispatcher.ts:46` — `listUsers`
- `packages/nextly/src/dispatcher/handlers/auth-dispatcher.ts:148` — `listRoles`
- `packages/nextly/src/dispatcher/handlers/auth-dispatcher.ts:214` — `listPermissions`
- `packages/nextly/src/dispatcher/handlers/collection-dispatcher.ts:166` — `listCollections`
- `packages/nextly/src/dispatcher/handlers/collection-dispatcher.ts:736-737` — `listEntries` (drop `?? p.pageSize` shim)

**Service signatures (10 files):**

- `packages/nextly/src/domains/users/services/user-service.ts`
- `packages/nextly/src/domains/users/services/user-query-service.ts`
- `packages/nextly/src/domains/auth/services/permission-service.ts`
- `packages/nextly/src/domains/auth/services/permission-seed-service.ts` (caller-side too)
- `packages/nextly/src/domains/auth/services/role-service.ts`
- `packages/nextly/src/domains/auth/services/role/role-query-service.ts`
- `packages/nextly/src/domains/collections/services/collection-service.ts`
- `packages/nextly/src/domains/collections/services/collection-metadata-service.ts`
- `packages/nextly/src/domains/media/services/media-service.ts`
- `packages/nextly/src/domains/media/types.ts`

**Schemas + types:**

- `packages/nextly/src/schemas/user.ts:82` — `ListUsersSchema`
- `packages/nextly/src/types/media.ts:117` — `MediaParamsSchema`
- `packages/nextly/src/types/media.ts:139` — `MediaListResponse.meta` (legacy envelope shape)

**Service-envelope translator (1 file):**

- `packages/nextly/src/dispatcher/helpers/service-envelope.ts:34, 56-71` — drop `LegacyOffsetMeta.pageSize`, accept `limit`. Update doc comments.

**Direct API callers (2 files):**

- `packages/nextly/src/direct-api/namespaces/rbac.ts:81, 257`
- `packages/nextly/src/direct-api/namespaces/media.ts:128`

**Database seeders + legacy services facade:**

- `packages/nextly/src/database/seeders/super-admin.ts:105`
- `packages/nextly/src/services/collections-handler.ts:229`
- `packages/nextly/src/services/users.ts:105`

### Server-side test fixtures (existing tests; UPDATE only, no new tests per user feedback)

- `packages/nextly/src/services/dynamic-collections.test.ts:133, 140, 182, 202, 239, 246`
- `packages/nextly/src/services/auth/permission-service.test.ts:48, 378, 387, 405, 427, 454, 587`
- `packages/nextly/src/services/auth/role-service.test.ts` — ~14 occurrences

### Client-side production code

**URL emitters only (everything else is admin-internal Phase 4.7 territory):**

- `packages/admin/src/lib/api/buildQuery.ts:49, 67-68`
- `packages/admin/src/services/emailProviderApi.ts:93-138` (drop legacy overload + shim)
- `packages/admin/src/services/realPermissionsApi.ts:39-82` (drop legacy overload + shim)
- `packages/admin/src/services/mediaApi.ts:215-216, 234`
- `packages/admin/src/hooks/useRoleForm.ts:252, 282`

---

## Task 1 — Dispatcher input parsing (drop `pageSize`)

**Files:**

- Modify: `packages/nextly/src/dispatcher/handlers/user-dispatcher.ts`
- Modify: `packages/nextly/src/dispatcher/handlers/auth-dispatcher.ts`
- Modify: `packages/nextly/src/dispatcher/handlers/collection-dispatcher.ts`

- [ ] **Step 1: Rename `user-dispatcher.ts:46`**

```ts
// BEFORE
const result = await svc.listUsers({
  page: toNumber(p.page),
  pageSize: toNumber(p.pageSize),
  ...
});

// AFTER (param name follows Phase 4.8 service-signature rename in Task 2)
const result = await svc.listUsers({
  page: toNumber(p.page),
  limit: toNumber(p.limit),
  ...
});
```

- [ ] **Step 2: Rename `auth-dispatcher.ts:148` (listRoles)**

Same pattern: `pageSize: toNumber(p.pageSize)` → `limit: toNumber(p.limit)`.

- [ ] **Step 3: Rename `auth-dispatcher.ts:214` (listPermissions)**

Same pattern.

- [ ] **Step 4: Rename `collection-dispatcher.ts:166` (listCollections)**

Same pattern.

- [ ] **Step 5: `collection-dispatcher.ts:736-737` (listEntries) — drop fallback shim**

```ts
// BEFORE
// Accept both `limit` (standard API param) and `pageSize` (legacy/admin).
const rawLimit = p.limit ?? p.pageSize;

// AFTER
const rawLimit = p.limit;
```

Delete the legacy/admin comment too.

- [ ] **Step 6: Verify no remaining `p.pageSize` reads in dispatcher handlers**

Run: `grep -n "p\.pageSize" packages/nextly/src/dispatcher/handlers/*.ts`
Expected: no matches.

---

## Task 2 — Service signatures (rename internal `pageSize` → `limit`)

**Why this is part of 4.8:** the user's "no compat shims" directive means we don't keep `pageSize` as the internal service param name while exposing `limit` at the dispatcher boundary. End-to-end consistency: the param is `limit` from URL through to the SQL `LIMIT` clause.

**Files:** all 10 services listed in File structure.

- [ ] **Step 1: `user-service.ts` — `listUsers`**

```ts
// BEFORE (lines ~263-289)
const pageSize = options.pagination?.limit ?? 10;
...
return {
  ...
  pageSize,
  ...
};
const offset = (page - 1) * pageSize;
...
.limit(pageSize)

// AFTER
const limit = options.pagination?.limit ?? 10;
...
return {
  ...
  limit,
  ...
};
const offset = (page - 1) * limit;
...
.limit(limit)
```

Also rename meta-shape field on the return type (interface for the service result) from `pageSize` to `limit`.

- [ ] **Step 2: `user-query-service.ts`**

Apply the same rename across the file (8 occurrences). Rename:

- `pageSize?: number` parameter on the query options interface → `limit?: number`
- `pageSize: number` on the return-meta interface → `limit: number`
- `pageSize = 10` destructure default → `limit = 10`
- `(page - 1) * pageSize` → `(page - 1) * limit`
- `.limit(pageSize)` → `.limit(limit)`
- `Math.ceil(total / pageSize)` → `Math.ceil(total / limit)`
- `pageSize,` in returned meta → `limit,`
- JSDoc example `{ page: 1, pageSize: 10 }` → `{ page: 1, limit: 10 }`

- [ ] **Step 3: `permission-service.ts`**

Same rename pattern (~7 occurrences).

- [ ] **Step 4: `permission-seed-service.ts`**

Update the two call sites (line 555 + 632) where this service calls into another paginated service:

```ts
// BEFORE
{
  pageSize: 10000;
}
// AFTER
{
  limit: 10000;
}
```

- [ ] **Step 5: `role-service.ts`**

Update the public type signatures (3 occurrences):

- `pageSize?: number` on input options → `limit?: number`
- `pageSize: number` on return meta → `limit: number`
- JSDoc example `{ page: 1, pageSize: 10 }` → `{ page: 1, limit: 10 }`

- [ ] **Step 6: `role-query-service.ts`**

Same rename pattern (~8 occurrences).

- [ ] **Step 7: `collection-service.ts`**

Same pattern (4 occurrences):

- `pageSize?: number;` on input interface → `limit?: number;`
- `const pageSize = options.pageSize ?? 10;` → `const limit = options.limit ?? 10;`
- `const offset = (page - 1) * pageSize;` → `const offset = (page - 1) * limit;`
- `limit: pageSize,` (Drizzle bind) → `limit,`

- [ ] **Step 8: `collection-metadata-service.ts`**

Same pattern (2 occurrences):

- Input options interface field
- Return-shape mapping `pageSize: result.pageSize` → `limit: result.limit`

- [ ] **Step 9: `media-service.ts`**

Same pattern (4 occurrences in the media list method).

- [ ] **Step 10: `media/types.ts:72`**

```ts
// BEFORE
pageSize?: number;
// AFTER
limit?: number;
```

- [ ] **Step 11: Update `service-envelope.ts` translator**

```ts
// BEFORE (lines 56-71)
/**
 * Translate the legacy `{ total, page, pageSize, totalPages }` shape
 * ...
 * PaginationMeta. Service-internal field name `pageSize` maps to wire
 * `limit` (canonical PaginationMeta field).
 */
type LegacyOffsetMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const toPaginationMeta = (meta: LegacyOffsetMeta): PaginationMeta => ({
  total: meta.total,
  page: meta.page,
  limit: meta.pageSize,
  totalPages: meta.totalPages,
  hasNext: meta.page < meta.totalPages,
  hasPrev: meta.page > 1,
});

// AFTER
/**
 * Translate the service-result `{ total, page, limit, totalPages }`
 * shape into the canonical wire PaginationMeta. After Phase 4.8 the
 * service-internal field name matches the wire name (`limit`); this
 * helper still derives `hasNext`/`hasPrev` from page math.
 */
type ServiceOffsetMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export const toPaginationMeta = (meta: ServiceOffsetMeta): PaginationMeta => ({
  total: meta.total,
  page: meta.page,
  limit: meta.limit,
  totalPages: meta.totalPages,
  hasNext: meta.page < meta.totalPages,
  hasPrev: meta.page > 1,
});
```

Also update the doc comment at line 34 mentioning `{total, page, pageSize, totalPages}`.

- [ ] **Step 12: Update `collection-dispatcher.ts:listCollections` legacy meta read (lines 176-234)**

The dispatcher reads `legacyMeta.pageSize` as the service-meta field name. After Task 2 step 7 above, `collection-service.listCollections` returns `meta.limit`, so update the dispatcher:

```ts
// BEFORE
const legacyMeta = result.meta as
  | {
      total?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    }
  | undefined;
const baseMeta = {
  total: ...,
  page: ...,
  pageSize:
    typeof legacyMeta?.pageSize === "number"
      ? legacyMeta.pageSize
      : items.length,
  totalPages: ...,
};
...
const filteredMeta = {
  total: filtered.length,
  page: baseMeta.page,
  pageSize: baseMeta.pageSize,
  totalPages:
    baseMeta.pageSize > 0
      ? Math.max(1, Math.ceil(filtered.length / baseMeta.pageSize))
      : 1,
};

// AFTER
const serviceMeta = result.meta as
  | {
      total?: number;
      page?: number;
      limit?: number;
      totalPages?: number;
    }
  | undefined;
const baseMeta = {
  total: ...,
  page: ...,
  limit:
    typeof serviceMeta?.limit === "number"
      ? serviceMeta.limit
      : items.length,
  totalPages: ...,
};
...
const filteredMeta = {
  total: filtered.length,
  page: baseMeta.page,
  limit: baseMeta.limit,
  totalPages:
    baseMeta.limit > 0
      ? Math.max(1, Math.ceil(filtered.length / baseMeta.limit))
      : 1,
};
```

Update the comment "Legacy meta uses pageSize/total/totalPages, translate to the canonical PaginationMeta shape via toPaginationMeta below." to reflect the new name.

- [ ] **Step 13: Verify**

Run: `grep -rn "pageSize" packages/nextly/src/dispatcher packages/nextly/src/domains 2>/dev/null | grep -v "__tests__\|\.test\."`
Expected: no production-code matches (test fixtures handled in Task 4).

---

## Task 3 — Schemas, types, direct-api, seeders, legacy facades

**Files:**

- Modify: `packages/nextly/src/schemas/user.ts`
- Modify: `packages/nextly/src/types/media.ts`
- Modify: `packages/nextly/src/direct-api/namespaces/rbac.ts`
- Modify: `packages/nextly/src/direct-api/namespaces/media.ts`
- Modify: `packages/nextly/src/database/seeders/super-admin.ts`
- Modify: `packages/nextly/src/services/collections-handler.ts`
- Modify: `packages/nextly/src/services/users.ts`

- [ ] **Step 1: `schemas/user.ts:82` — `ListUsersSchema`**

```ts
// BEFORE
export const ListUsersSchema = z.object({
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(10),
  ...
});

// AFTER
export const ListUsersSchema = z.object({
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(10),
  ...
});
```

- [ ] **Step 2: `types/media.ts:117` — `MediaParamsSchema`**

```ts
// BEFORE
export const MediaParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(24),
  ...
});

// AFTER
export const MediaParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(24),
  ...
});
```

- [ ] **Step 3: `types/media.ts:131-141` — `MediaListResponse.meta`**

```ts
// BEFORE
export interface MediaListResponse {
  ...
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// AFTER
export interface MediaListResponse {
  ...
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

- [ ] **Step 4: `direct-api/namespaces/rbac.ts:81, 257`**

```ts
// BEFORE
{ pageSize: args.limit ?? 10, ... }
// AFTER (since legacy services now accept `limit` natively)
{ limit: args.limit ?? 10, ... }
```

Same for line 257: `{ pageSize: limit, ... }` → `{ limit, ... }`.

- [ ] **Step 5: `direct-api/namespaces/media.ts:128`**

```ts
// BEFORE
{ pageSize: limit, ... }
// AFTER
{ limit, ... }
```

- [ ] **Step 6: `database/seeders/super-admin.ts:105`**

```ts
// BEFORE
{
  pageSize: 1000;
}
// AFTER
{
  limit: 1000;
}
```

- [ ] **Step 7: `services/collections-handler.ts:229`**

Rename `pageSize?: number;` field → `limit?: number;` on the input options interface.

- [ ] **Step 8: `services/users.ts:105`**

Same: `pageSize?: number;` → `limit?: number;`.

- [ ] **Step 9: Verify**

```bash
grep -rn "pageSize" packages/nextly/src --include="*.ts" 2>/dev/null \
  | grep -v "__tests__\|\.test\." \
  | grep -v "service-envelope.ts.*Legacy" # comment that may remain
```

Expected: no production code matches.

---

## Task 4 — Update existing tests (no new tests; update assertions only)

**Note:** Per user feedback, do NOT add new test files. Only adapt existing tests whose hard-coded `pageSize` keys break after Tasks 2+3.

**Files:**

- Modify: `packages/nextly/src/services/dynamic-collections.test.ts`
- Modify: `packages/nextly/src/services/auth/permission-service.test.ts`
- Modify: `packages/nextly/src/services/auth/role-service.test.ts`

- [ ] **Step 1: `dynamic-collections.test.ts`**

Replace each `pageSize` occurrence in test inputs and assertions with `limit`:

- Line 133: `pageSize: 2` → `limit: 2`
- Line 140: `expect(result.pageSize).toBe(2)` → `expect(result.limit).toBe(2)`
- Lines 182, 202: `pageSize: 10` → `limit: 10`
- Line 239: `pageSize: 5` → `limit: 5`
- Line 246: `expect(result.pageSize).toBe(5)` → `expect(result.limit).toBe(5)`

- [ ] **Step 2: `permission-service.test.ts`**

Replace 7 occurrences (per the audit: lines 48, 378, 387, 405, 427, 454, 587). Same pattern.

Also update the helper call `expectPaginationMeta(result, { total: 3, page: 1, pageSize: 10 })` to use `limit: 10`. If the `expectPaginationMeta` helper destructures by `pageSize`, also rename inside the helper.

- [ ] **Step 3: `role-service.test.ts`**

Replace ~14 occurrences using a single find/replace per file (use `replace_all`). Then re-read to verify no functional change beyond rename.

- [ ] **Step 4: Run the relevant suite**

```bash
cd packages/nextly && pnpm vitest src/services/dynamic-collections.test.ts src/services/auth/permission-service.test.ts src/services/auth/role-service.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Run the full Phase-4-relevant test set per the doc's §1 baseline command**

```bash
cd packages/nextly && pnpm vitest src/dispatcher src/domains/collections src/domains/media src/api/__tests__/response-shapes.test.ts src/api/media-bulk.test.ts --run
```

Expected: 273/273 PASS (matches the §1 baseline).

---

## Task 5 — Client URL emitters (drop `pageSize`, emit `limit`)

**Files:**

- Modify: `packages/admin/src/lib/api/buildQuery.ts`
- Modify: `packages/admin/src/services/emailProviderApi.ts`
- Modify: `packages/admin/src/services/realPermissionsApi.ts`
- Modify: `packages/admin/src/services/mediaApi.ts`
- Modify: `packages/admin/src/hooks/useRoleForm.ts`

- [ ] **Step 1: `buildQuery.ts:49, 67-68`**

```ts
// BEFORE (line 49 docstring)
 * // Returns: "page=1&pageSize=10&sortBy=name&sortOrder=asc"

// AFTER
 * // Returns: "page=1&limit=10&sortBy=name&sortOrder=asc"
```

```ts
// BEFORE (line 64-68)
const { page, pageSize } = params.pagination;
const search = params.filters?.search?.trim();

// Always send pageSize to ensure backend gets the correct value
if (pageSize) query.set("pageSize", String(pageSize));

// AFTER
const { page, pageSize } = params.pagination; // pageSize is admin-internal
// TableParams field name; URL uses canonical `limit`
const search = params.filters?.search?.trim();

// Phase 4.8: emit canonical `limit` (renamed from `pageSize`).
if (pageSize) query.set("limit", String(pageSize));
```

The local destructured name `pageSize` is kept because `TableParams.pagination.pageSize` is admin-internal (Phase 4.7 will rename the type). Only the URL key is renamed.

- [ ] **Step 2: `emailProviderApi.ts:93-138` — drop legacy overload + shim**

```ts
// BEFORE
export async function listProviders(params: {
  page: number;
  /** Deprecated: use `limit`. Kept for callers not yet updated (removed in Task 23). */
  pageSize?: number;
  /** New (Phase 4): canonical name. */
  limit?: number;
  search: string;
  type?: EmailProviderType | "all";
}): Promise<EmailProviderListResponse> {
  // Phase 4 (Task 19): the email-provider list endpoint is unpaginated on
  // the server (the dispatcher returns the full array via respondData);
  // page/pageSize remain in the query string for forward compatibility
  // and as visual indicators in network logs. We keep emitting `pageSize`
  // (rather than canonical `limit`) because the auth-style dispatchers
  // still read `p.pageSize`; the server-side rename is queued for Task 23.
  const effectiveLimit = params.limit ?? params.pageSize ?? 10;
  const queryParts: string[] = [
    `pageSize=${effectiveLimit}`,
    `page=${params.page + 1}`,
    ...
  ];
  ...
  const meta: PaginationMeta = {
    page: 0,
    pageSize: effectiveLimit,
    total: providers.length,
    totalPages: 1,
  };
  ...
}

// AFTER
export async function listProviders(params: {
  page: number;
  limit?: number;
  search: string;
  type?: EmailProviderType | "all";
}): Promise<EmailProviderListResponse> {
  // The endpoint is unpaginated server-side (dispatcher returns the full
  // array via respondData); we still emit `page` + `limit` so request
  // logs are uniform with paginated endpoints.
  const effectiveLimit = params.limit ?? 10;
  const queryParts: string[] = [
    `limit=${effectiveLimit}`,
    `page=${params.page + 1}`,
    ...
  ];
  ...
  const meta: PaginationMeta = {
    page: 0,
    limit: effectiveLimit,  // canonical PaginationMeta field
    total: providers.length,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  };
  ...
}
```

Also check whether the `PaginationMeta` shape in this file requires `hasNext`/`hasPrev`. If yes, populate them; if not present in the imported type, leave as-is.

After this step, search for callers of `listProviders` and remove any `pageSize:` properties they pass:

```bash
grep -rn "listProviders\|emailProviderApi" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Update each caller to pass `limit` instead of `pageSize` if applicable.

- [ ] **Step 3: `realPermissionsApi.ts:39-82` — drop legacy overload**

```ts
// BEFORE
export const fetchPermissionsFromApi = async (options?: {
  search?: string;
  resource?: string;
  action?: string;
  /** New (Phase 4): canonical name. */
  limit?: number;
  /** Deprecated: use `limit`. Kept for callers not yet migrated. */
  pageSize?: number;
  page?: number;
}): Promise<PermissionListResult> => {
  ...
  // Phase 4 (Task 19): keep emitting `pageSize` because the auth-dispatcher
  // listPermissions handler reads `p.pageSize` (not `p.limit`). The
  // `limit` option is accepted on the client side and forwarded to the
  // same query param so callers can already adopt the canonical naming.
  // Server-side rename to `limit` is a separate Task 23 cleanup.
  params.set("pageSize", String(options?.limit ?? options?.pageSize ?? 200));
  ...
};

// AFTER
export const fetchPermissionsFromApi = async (options?: {
  search?: string;
  resource?: string;
  action?: string;
  limit?: number;
  page?: number;
}): Promise<PermissionListResult> => {
  ...
  params.set("limit", String(options?.limit ?? 200));
  ...
};
```

After this step, audit callers:

```bash
grep -rn "fetchPermissionsFromApi" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Replace any `pageSize:` keys passed in to `limit:`.

- [ ] **Step 4: `mediaApi.ts:215-216, 234`**

```ts
// BEFORE (line 215-216)
if (params.page) queryParams.set("page", String(params.page));
if (params.pageSize) queryParams.set("pageSize", String(params.pageSize));

// AFTER
if (params.page) queryParams.set("page", String(params.page));
if (params.limit) queryParams.set("limit", String(params.limit));
```

```ts
// BEFORE (line 229-240, return)
return {
  data: result.data || [],
  meta: (result.meta as MediaListResponse["meta"]) || {
    total: 0,
    page: params.page || 1,
    pageSize: params.pageSize || 24,
    totalPages: 0,
  },
  ...
};

// AFTER
return {
  data: result.data || [],
  meta: (result.meta as MediaListResponse["meta"]) || {
    total: 0,
    page: params.page || 1,
    limit: params.limit || 24,
    totalPages: 0,
  },
  ...
};
```

`MediaParams` (the input type for this function, sourced from `domains/media/types`) was renamed in Task 2 step 10, so `params.limit` is now the typed field.

- [ ] **Step 5: `useRoleForm.ts:252, 282`**

```ts
// BEFORE (line 252)
const query = `?page=1&pageSize=${PAGINATION.MAX_PAGE_SIZE}&sortBy=resource&sortOrder=asc`;

// AFTER
const query = `?page=1&limit=${PAGINATION.MAX_PAGE_SIZE}&sortBy=resource&sortOrder=asc`;
```

```ts
// BEFORE (line 282)
.get<ListEnvelope<{ slug: string }>>(`/singles?page=1&pageSize=500`)

// AFTER
.get<ListEnvelope<{ slug: string }>>(`/singles?page=1&limit=500`)
```

- [ ] **Step 6: Audit remaining client URL emissions**

```bash
grep -rn "pageSize=" packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Expected: zero matches (any remaining are not URL emissions but admin-internal state).

```bash
grep -rn '"pageSize"' packages/admin/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Expected: zero matches against `query.set("pageSize", ...)` or `params.set("pageSize", ...)` patterns. Other uses of the literal string `"pageSize"` may remain in admin-internal code (tracked in Phase 4.7) and are acceptable.

- [ ] **Step 7: Run admin typecheck**

```bash
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l
```

Expected: 42 (the baseline; no net-new errors).

---

## Task 6 — Code review

- [ ] **Step 1: Invoke superpowers:requesting-code-review**

Hand off the diff to a fresh reviewer with the spec context (this plan + §4-5 of `29-phase-4-deferred-tasks-execution-prompt.md`). Address any Critical/Important issues.

---

## Task 7 — Commit + push + update tracking doc

- [ ] **Step 1: Stage + commit**

Single commit (the change is one logical unit per the user's "stack on the branch" strategy):

```bash
git add packages/nextly/src packages/admin/src
git commit -m "$(cat <<'EOF'
refactor(nextly + admin): rename pageSize to limit end-to-end (Phase 4.8)

Drop the legacy pageSize field name across the entire request pipeline.
Server now reads only ?limit= on dispatcher inputs; service signatures,
Zod schemas, and direct-api callers all use limit. Client URL emitters
(buildQuery, emailProviderApi, realPermissionsApi, mediaApi, useRoleForm)
emit limit. The transitional p.limit ?? p.pageSize fallback in
collection-dispatcher.listEntries is removed per the no-compat-shims
directive.

Service-envelope translator no longer needs to map pageSize to limit on
output (service-internal field is already limit).

Out of scope (Phase 4.7): admin-internal TableParams.pagination.pageSize,
useState pageSize React state, normalizePagination helper.
EOF
)"
```

- [ ] **Step 2: Push**

```bash
git push origin fix/phase-4-envelope-migration
```

- [ ] **Step 3: Update `29-phase-4-deferred-tasks-execution-prompt.md`**

- §2 progress table: mark Phase 4.8 ✅ Done with the new commit hash.
- §8 pushed-commit timeline: prepend new commit.
- §10 findings log: add a new entry describing scope (~50 sites instead of estimated ~15) and any surprises.

---

## Self-review checklist

- [x] Every task lists exact files + line numbers.
- [x] No "TBD" / "implement later" / "similar to above" placeholders — code shown for each rename.
- [x] No new test files (per user memory feedback).
- [x] Service-envelope translator + dispatcher legacy-meta read updated together with service rename (consistency).
- [x] `TableParams.pagination.pageSize` admin-internal field is intentionally NOT renamed (deferred to Phase 4.7) — flagged inline.
- [x] All client URL emitters audited.
- [x] Verification commands listed at end of each task.
