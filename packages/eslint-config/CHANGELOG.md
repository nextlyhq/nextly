# @nextlyhq/eslint-config

## 0.0.2-alpha.11

### Patch Changes

- [#41](https://github.com/nextlyhq/nextly/pull/41) [`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix drizzle-kit rename TUI ("Is `dc_posts` table created or renamed from another table?") firing on SQLite and MySQL after the schema-apply scope-reduction landed. The scope-reduction filter iterated by managed-table names and stripped the static system tables that `buildDrizzleSchema` injects so drizzle-kit's diff recognises them. On SQLite/MySQL drizzle-kit ignores `tablesFilter`, so the missing system tables looked like drops, paired with the managed adds, and produced the rename TUI on every fresh-install boot — crashing Next.js's non-TTY server thread. The scope-reduction filter now preserves non-managed entries via `!isManagedTable(name)`, restoring the injection's intended effect on every dialect.

## 0.0.2-alpha.10

### Patch Changes

- [`7fde28a`](https://github.com/nextlyhq/nextly/commit/7fde28a9dfa4bd454d8ed2eab97b4b7b9f8f23b6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Bump private internal packages to keep their versions in sync with the public packages in the workspace.

## 0.0.2-alpha.9

### Patch Changes

- [#38](https://github.com/nextlyhq/nextly/pull/38) [`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix: variant URLs in populated `media.sizes[*].url` are now absolutized too. The initial absolutization pass only rewrote the top-level `url` and `thumbnailUrl` fields, so on SQLite — which stores `media.sizes` as TEXT and returns the column as an unparsed JSON string — clients consuming `getMediaVariant(media, "card")` on populated entries still received relative `/uploads/...` paths. `absolutizeMediaUrls` now normalises string-encoded sizes into an object before rewriting variant URLs, so populated media on entry responses returns reachable variant URLs across every dialect. Unparseable JSON resolves to `null` rather than leaking the raw string to the API consumer.

  Also: `toAbsoluteMediaUrl` and `absolutizeMediaUrls` resolve `baseUrl` lazily — the env-backed default fires only when a relative URL actually needs prefixing. Pass-through cases (absolute URLs, null/undefined/empty) no longer touch the env proxy, so the "absolute URLs unchanged" contract holds in contexts that have not booted env validation (isolated tests, bundler-time analysis).

## 0.0.2-alpha.8

### Patch Changes

- [#36](https://github.com/nextlyhq/nextly/pull/36) [`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media URLs returned from the API are now absolute. Previously, the local storage adapter wrote `/uploads/...` paths and surfaced them verbatim in API responses — mobile clients, edge workers, and any consumer without the deployment's origin baked in could not resolve the URL. Now, `MediaService` responses, populated `media` relations on entry responses, and the collection upload handlers (`POST` / `GET /admin/api/collections/<slug>/uploads`) prefix relative URLs with `NEXT_PUBLIC_APP_URL` (priority: `emailConfig.baseUrl` override > `NEXT_PUBLIC_APP_URL` > `http://localhost:3000` in dev). Cloud-adapter URLs (S3, Vercel Blob, R2) are already absolute and pass through unchanged. Consumers that previously concatenated the base URL themselves should drop the prefix — double-prefix detection is in place, but the new behaviour means the prefix is no longer needed. The env schema already requires `NEXT_PUBLIC_APP_URL` in production, so the localhost fallback is only reachable in development.

  Internal: extracted a shared `getBaseUrl(override?)` helper at `src/shared/lib/get-base-url.ts` so the email service and the new media-absolutization path resolve through one priority chain. `EmailService.getBaseUrl` and the new `getMediaBaseUrl` both delegate to it.

## 0.0.2-alpha.7

### Patch Changes

- [#34](https://github.com/nextlyhq/nextly/pull/34) [`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix severe Builder slowness and connection-pool exhaustion when running Nextly against Neon Postgres, and complete the code-first column-delete workflow. Adapter now wires the provider's declared `statementTimeoutMs` into `pg.Pool` (Neon's 30s default was previously ignored, letting stuck queries pin pool slots forever) and bumps Node 20+'s 250 ms Happy Eyeballs per-address timeout floor to 5 s on first connect so transcontinental Neon endpoints stop surfacing `ETIMEDOUT` after exhausting every resolved address. `DB_POOL_MAX`/`MIN`/`IDLE_TIMEOUT`/`QUERY_TIMEOUT` env vars were always documented but never plumbed into the factory — they now flow through with per-field `??` fallback so each value can fall back to the adapter's dialect-specific defaults (notably the PG adapter's `min: 0` for Neon auto-suspend recovery). Boot/HMR drift-check now uses bounded concurrency (3 workers) instead of unbounded `Promise.all` that saturated a Neon pool of 5 with 10+ collections. HMR `serverComponentChanges` events get a 300 ms trailing debounce so editor burst-saves stop firing a full pipeline per save. A short-lived live-snapshot cache deduplicates the two `introspectLiveSnapshot` calls that previously fired during a single Builder apply, and a missing `instrumentation.ts` warning surfaces in dev to nudge users toward the single-worker warmup pattern. A new fast in-memory DDL emitter on PostgreSQL bypasses drizzle-kit's ~10 s catalog re-introspection for the common Builder op set (`add_column`, `add_table`), and even on the slow-path fallback the pushSchema call is now scoped to only the table(s) actually touched by the resolved ops rather than every managed table. `filterUnsafeStatements` also blocks orphan `DROP SEQUENCE` / `DROP INDEX` whose inferred owner table is not in the desired schema. A new diff-time default normaliser collapses Postgres's redundant `::<type>` cast suffix (e.g. `'draft'::character varying`) and lowercases `now()` so the diff stops emitting phantom `change_column_default` ops for every system column on every apply; a long-standing descriptor drift between `runtime-schema-generator` and `field-column-descriptor` (status `text` vs `varchar`, missing `now()` defaults on `created_at`/`updated_at`) is also fixed so the new fast path actually triggers in the real Builder flow. End-to-end on a real Neon instance: Builder Save HTTP timing drops from ~11 s to ~5 s and the in-pipeline schema apply drops from ~10 s to ~1.4 s. Code-first column deletes now flow through a new `destructive_drop` `ClassifierEvent` that the `ClackTerminalPromptDispatcher` renders as a `Drop "<column>" from "<table>"?` confirm in the dev terminal — removing a field from `nextly.config.ts` and saving prompts you to confirm before destroying data, matching Drizzle Kit's `push` UX; `NEXTLY_ALLOW_CODE_FIRST_DROPS=1` auto-confirms every drop without prompting for CI/non-interactive workflows. Finally, the API Playground response viewer no longer crashes with "Unrecognized extension value" — the admin bundle was loading two copies of `@codemirror/state` (6.5.3 + 6.6.0) which broke `instanceof Extension`; a `pnpm.overrides` pin forces a single resolution.

## 0.0.2-alpha.6

### Patch Changes

- [#32](https://github.com/nextlyhq/nextly/pull/32) [`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal refactor: consolidate the `packages/nextly/src/services/auth/` shim layer. The shim was a directory of one-line `export *` re-exports left over from an earlier reorganisation; the canonical code already lived in `packages/nextly/src/domains/auth/services/`. The shim directory has been removed and 29 internal call sites have been pointed at the canonical location. A duplicate test suite of 13 files (mechanical-path-only drift, no logic divergence) has been deleted in favour of the existing copies under `domains/auth/__tests__/`. A new `@nextly/domains/*` TypeScript path alias is added to match the existing `@nextly/services/*` / `@nextly/auth/*` pattern. No public exports, runtime behaviour, or wire-format changes; this is shipped as a patch because every package version moves together in the alpha train.

- [#30](https://github.com/nextlyhq/nextly/pull/30) [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `create-nextly-app` now prompts for a folder name when none is given on the command line. Previously, running `npx create-nextly-app` with no positional argument was silently treated as "install in the current directory" and then aborted with a `Directory not empty` error once the user finished the template and database prompts. The CLI now asks `What should your project be called?` with `my-nextly-app` pre-filled. You can accept the default with Enter, type any folder name, or type `.` (or `./`) to install in the current directory, matching the way the positional argument already worked. When the chosen target directory is non-empty the CLI now offers a three-option recovery prompt (cancel, remove existing files and continue, or ignore files and continue) instead of aborting outright. The `remove` option preserves any `.git` directory so existing history is kept.

  Note for scripted or CI use: the no-argument form is no longer equivalent to `npx create-nextly-app .`; it now opens an interactive prompt. If you were relying on the previous behavior in a non-interactive environment, pass `.` (or any folder name) explicitly.

## 0.0.2-alpha.5

### Patch Changes

- [#28](https://github.com/nextlyhq/nextly/pull/28) [`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `Cannot find package '@nextlyhq/plugin-form-builder'` on `pnpm dev` for blank scaffolds. The base admin page (`templates/base/src/app/admin/[[...params]]/page.tsx`) and the existing-project admin generator both hard-coded three side-effect imports for `@nextlyhq/plugin-form-builder`, but the package was only added to `package.json` on the fresh-scaffold npm path. Blank scaffolds and existing-project installs got the imports without the dep, so `next dev` failed at module resolution. The plugin is now opt-in per template: blank ships a plugin-less admin page; the blog template overlays a blog-specific admin page that re-adds the imports (mirroring how `formBuilderPlugin` is registered only in the blog config). `generatePackageJson` and the yalc paths in `installDependencies` accept a `projectType` and only include `@nextlyhq/plugin-form-builder` when the selected template uses it.

## 0.0.2-alpha.4

### Patch Changes

- [#26](https://github.com/nextlyhq/nextly/pull/26) [`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection mutation paths now resolve the physical table through `collection.tableName`, honoring `dbName` overrides instead of always deriving the name from the slug. The code-first boot sync detects when a collection's resolved `tableName` differs from the row in `dynamic_collections`, renames the physical table (Postgres/SQLite/MySQL quoted `ALTER TABLE ... RENAME TO`), writes the new name back, and invalidates the cached Drizzle schema in `CollectionFileManager` so the next request rebuilds against the renamed table — previously a `dbName` change left CRUD pointing at the stale table until a server restart. When both the old and new physical tables exist, the rename is skipped with a warn so the user can resolve the conflict manually. Component runtime-schema refresh after a UI-driven create/update/apply now flows through the DI `SchemaRegistry` (with a typed fallback to the adapter's `tableResolver` for non-DI paths) and surfaces failures as warnings instead of swallowing them in a silent try/catch — the prior behavior left `comp_*` queries selecting pre-rename column names until restart. Generated timestamp columns (`createdAt`, `updatedAt`) now emit `withTimezone: false` / plain `TIMESTAMP` for Postgres, aligning behavior across SQLite, MySQL, and Postgres.

## 0.0.2-alpha.3

### Patch Changes

- [#23](https://github.com/nextlyhq/nextly/pull/23) [`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix Single document fields appearing empty after a component-field rename. Schema-apply and external-schema-update handlers invalidated `["collections"]`, `["entries"]`, `["singles"]`, and `["components"]` — but Single document data lives under a separate `["single-documents"]` namespace (used by `useSingleDocument`), which was never invalidated. After a rename, `useSingleSchema` refetched with the new field name while `useSingleDocument` kept serving cached data keyed by the old name, so the form rendered `data[newName]` as `undefined` and the field appeared blank until a hard refresh. Collections were unaffected because `useEntry` lives under `["entries"]`, which was already in the invalidation list. The `["single-documents"]` key is now invalidated alongside the others. Also propagate the Draft/Published `status` flag through `buildFullDesiredSchema` for both collections and singles, mirroring the earlier preview-pipeline fix so the full-schema build path doesn't drop the column either.

## 0.0.2-alpha.2

### Patch Changes

- [#19](https://github.com/nextlyhq/nextly/pull/19) [`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc) Thanks [@aqib-rx](https://github.com/aqib-rx)! - HTTP read endpoints now return entries/documents regardless of status by default. Previously, `GET /api/collections/<slug>/entries`, `GET /api/collections/<slug>/entries/<id>`, `GET /api/collections/<slug>/entries/count`, and `GET /api/singles/<slug>` defaulted to "published-only" and required `?status=all` to see drafts — confusing for the admin API Playground, which returned 404 for any status-enabled single or collection whose only document was still in draft. The new default is to return all records; pass `?status=published` (or `?status=draft`) to filter explicitly. The routes still require authentication, so this only affects callers that already have read permission.

## 0.0.2-alpha.1

### Patch Changes

- [#17](https://github.com/nextlyhq/nextly/pull/17) [`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix UI Schema Builder silently dropping the Draft/Published `status` column when editing a collection or single. Saving a field change on a `status: true` entity used to surface a "Rename status → \<new field\>" option (selected by default) because `previewDesiredSchema` did not propagate the Draft/Published flag into the desired snapshot — confirming the dialog DROPped the column and every subsequent entry POST with `status: "published"` failed with `table dc_<slug> has no column named status`. The flag now flows through the preview/apply pipeline for both collections and singles, so the column survives edits.

## 0.0.2-alpha.0

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.
