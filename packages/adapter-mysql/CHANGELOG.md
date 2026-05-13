# @nextlyhq/adapter-mysql

## 0.0.2-alpha.4

### Patch Changes

- [#23](https://github.com/nextlyhq/nextly/pull/23) [`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix Single document fields appearing empty after a component-field rename. Schema-apply and external-schema-update handlers invalidated `["collections"]`, `["entries"]`, `["singles"]`, and `["components"]` — but Single document data lives under a separate `["single-documents"]` namespace (used by `useSingleDocument`), which was never invalidated. After a rename, `useSingleSchema` refetched with the new field name while `useSingleDocument` kept serving cached data keyed by the old name, so the form rendered `data[newName]` as `undefined` and the field appeared blank until a hard refresh. Collections were unaffected because `useEntry` lives under `["entries"]`, which was already in the invalidation list. The `["single-documents"]` key is now invalidated alongside the others. Also propagate the Draft/Published `status` flag through `buildFullDesiredSchema` for both collections and singles, mirroring the earlier preview-pipeline fix so the full-schema build path doesn't drop the column either.

- Updated dependencies [[`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.4

## 0.0.2-alpha.3

### Patch Changes

- [#19](https://github.com/nextlyhq/nextly/pull/19) [`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc) Thanks [@aqib-rx](https://github.com/aqib-rx)! - HTTP read endpoints now return entries/documents regardless of status by default. Previously, `GET /api/collections/<slug>/entries`, `GET /api/collections/<slug>/entries/<id>`, `GET /api/collections/<slug>/entries/count`, and `GET /api/singles/<slug>` defaulted to "published-only" and required `?status=all` to see drafts — confusing for the admin API Playground, which returned 404 for any status-enabled single or collection whose only document was still in draft. The new default is to return all records; pass `?status=published` (or `?status=draft`) to filter explicitly. The routes still require authentication, so this only affects callers that already have read permission.

- Updated dependencies [[`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.3

## 0.0.2-alpha.2

### Patch Changes

- [#17](https://github.com/nextlyhq/nextly/pull/17) [`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix UI Schema Builder silently dropping the Draft/Published `status` column when editing a collection or single. Saving a field change on a `status: true` entity used to surface a "Rename status → \<new field\>" option (selected by default) because `previewDesiredSchema` did not propagate the Draft/Published flag into the desired snapshot — confirming the dialog DROPped the column and every subsequent entry POST with `status: "published"` failed with `table dc_<slug> has no column named status`. The flag now flows through the preview/apply pipeline for both collections and singles, so the column survives edits.

- Updated dependencies [[`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.2

## 0.0.2-alpha.1

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.

- Updated dependencies [[`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.1

## 0.0.2-alpha.0

### Patch Changes

- [#4](https://github.com/nextlyhq/nextly/pull/4) [`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Initial alpha release of Nextly — a TypeScript-first, Next.js-native CMS and app framework.

  All 12 packages publish at `0.0.2-alpha.0` in lockstep under the `alpha` dist-tag.

  **Highlights:**
  - **Core (`nextly`)** — REST + Direct API, RBAC, hooks, and the runtime engine. API key prefix is `nx_live_`.
  - **Admin (`@nextlyhq/admin`)** — Full-featured admin dashboard.
  - **UI (`@nextlyhq/ui`)** — Headless component primitives shared across packages and plugins.
  - **CLI (`create-nextly-app`)** — Project scaffolder with blog and blank templates, multi-DB picker, telemetry opt-out.
  - **Database adapters** — `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql`, `@nextlyhq/adapter-sqlite`, plus the shared `@nextlyhq/adapter-drizzle` base.
  - **Storage adapters** — `@nextlyhq/storage-s3` (also R2 / MinIO / B2 / Wasabi), `@nextlyhq/storage-vercel-blob`, `@nextlyhq/storage-uploadthing`.
  - **Plugins (preview)** — `@nextlyhq/plugin-form-builder` for early exploration; public plugin APIs stabilize at the beta release.

  **Alpha caveats:** APIs may change before `1.0`. Pin exact versions in production.

  **Install:**

  ```bash
  pnpm create nextly-app@alpha my-app
  # or
  npx create-nextly-app@alpha my-app
  ```

- Updated dependencies [[`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.0
