# Platform verification notes (F0.1) — TEMPORARY (remove in M8)

Verified against live source on 2026-07-02 (branch `feat/page-builder-f0`).

## Admin API (save path + envelope)

- Admin fetcher base `BASE_URL = /admin/api` — `packages/admin/src/lib/api/fetcher.ts:28`.
- Entry endpoints (relative to base): `/collections/{slug}/entries[/{id}]` — `packages/admin/src/services/entryApi.ts:353,447,527,555`.
- **Full save URLs:** `POST/PATCH/DELETE /admin/api/collections/pages/entries[/{id}]`.
- **Mutation envelope:** `{ message, item }` — `entryApi.ts:526` (`protectedApi.post<{ message: string; item: Entry }>` → returns `result.item`). List → `{ items, meta }`; get-one → bare doc.
- Same-origin cookie auth; plain `fetch` from admin components carries the session.

## Reusable admin exports (don't rebuild)

- `MediaPickerDialog` is a **public** `@nextlyhq/admin` export — `packages/admin/src/index.ts:375` (+ `MediaPickerDialogProps` at :384). Reuse it for the Image block picker (M5).
- `registerComponents` / `registerComponent` / `registerKnownPlugin` are re-exported by `@nextlyhq/plugin-sdk/admin`.
- `entryApi` and the query hooks are **NOT** publicly exported → the full editor self-persists via a small `adminFetch` to `/admin/api` (M4).

## registerKnownPlugin visibility

- Marked `@internal` — `packages/admin/src/lib/plugins/component-registry.ts:277`. It is nonetheless what the official plugin template + `plugin-form-builder` use. We use it (eager + lazy registration) as the current convention; track for stabilization (not our debt to fix).

## Field-component auto-registration (field mount M7)

- `usePluginAutoRegistration(collections)` (`DynamicCollectionNav.tsx:110`) drives auto-registration; the collector (`component-registry.ts:321-334` doc) enumerates `admin.components.views.*` / injection paths. Whether it recurses into **field** `admin.component` paths is **unconfirmed**.
- **Chosen approach (decided F0.1 Step 2):** our `/admin` entry eagerly `registerComponents({ EditView, PageBuilderField })` at module load. That entry loads whenever the admin encounters our plugin — guaranteed for the `pages` collection via its Edit-view override path, and (for hosts without the `pages` collection) via the generated `plugin-admin-imports.generated.ts` import map.
- **M7 must verify** the single-only host case (a Single using `pageBuilderField` with our `pages` collection absent). If registration doesn't fire there, file a small Nextly enhancement: a recursive `collectFieldAdminComponentPaths(fields)` used by `usePluginAutoRegistration` + import-map generation. Does NOT block F0–M6.

## Versioning / release

- `.changeset/config.json` uses a **`fixed`** group containing all first-party packages (nextly, @nextlyhq/admin, @nextlyhq/ui, plugin-sdk, plugin-form-builder, adapters, storages) — they version in lockstep. Current: `0.0.2-alpha.29`.
- **`@nextlyhq/plugin-page-builder` must be added to that `fixed` array** and start at `0.0.2-alpha.29` (done in F0.2). Otherwise release versioning diverges.

## Current dependency versions (from plugin-form-builder@0.0.2-alpha.29)

- peers: `@nextlyhq/admin`/`nextly`/`@nextlyhq/ui` = `0.0.2-alpha.29`; `@nextlyhq/plugin-sdk` = `workspace:*`; `react` `^18||^19`; `next` `^14||^15||^16`; `@tanstack/react-query` `>=5`; `lucide-react` `>=0.400`.
- dnd (form-builder): `@dnd-kit/core ^6.1.0`, `@dnd-kit/sortable ^8.0.0`, `@dnd-kit/utilities ^3.2.2`. **NOTE:** the iframe canvas (M4) needs cross-iframe drag — evaluate `@dnd-kit/dom` at M4 and pin the correct package/version then (not in F0).
- build: `tsup ^8`, `typescript ^5.3`, `vitest ^4.0.8`, `@types/react 19.2.0`, target es2022, ESM, dts; CSS copied via tsup `onSuccess`.
- CSS parser for the style compiler (M2): `css-tree` (pure-JS, cross-env safe) — added as a dependency in F0.2.
