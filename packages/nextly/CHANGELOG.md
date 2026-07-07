# nextly

## 0.0.2-alpha.32

### Patch Changes

- Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.

- Updated dependencies []:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.32
  - @nextlyhq/adapter-mysql@0.0.2-alpha.32
  - @nextlyhq/adapter-postgres@0.0.2-alpha.32
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.32

## 0.0.2-alpha.31

### Patch Changes

- [#150](https://github.com/nextlyhq/nextly/pull/150) [`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Per-entry editor choice + the generic, plugin-agnostic platform hooks that power it. A collection or single can offer a per-entry **Default / Page Builder** toggle, and turning it on shows a visual canvas instead of the normal fields — delivered entirely through reusable extension points, with no page-builder-specific code in core or admin.
  - **Plugin field types round-trip to production.** `ui-schema.json` (the committable schema manifest) now accepts plugin-contributed field types, and the CLI registers `contributes.fieldTypes` before generating migrations — so a plugin field type resolves to its declared storage column and survives to production. Previously a UI-created plugin field was downgraded to `json` in the manifest, so the real type was lost outside dev.
  - **`layout: "takeover"` field-type flag.** A plugin field type can declare that, when a field of that type is active, the entry/single form collapses to just that field plus the field that controls its `admin.condition` — hiding the rest. Generic: it keys off field-type metadata (`branding.plugins[].fieldTypes[].layout`) and the existing condition evaluator, so any plugin field type can opt in.
  - **`contributes.admin.schemaBuilderSlot`.** Plugins can render a control above the field list in the collection/single schema builders, receiving `{ fields, setFields, disabled, context }` to add builder-time behavior (e.g. an editor-choice toggle) without core knowing the plugin.
  - **`contributes.admin.entryFormToolbarSlot`.** Plugins can render a control in the entry/single form header toolbar, reading and writing form state via react-hook-form — for form-level controls like a mode toggle.
  - **Managed (hidden) fields.** A field marked `admin.hidden` is kept out of the schema-builder "Your fields" list and out of the entry-form body while its value still lives in the form state — used for plugin plumbing that's driven by a toolbar control rather than shown as a field.

  `@nextlyhq/plugin-page-builder` is the first consumer of all of the above and is published through the same release: it registers a `page-builder` field type with `layout: "takeover"`, contributes the "Use Page Builder" schema-builder toggle and the per-entry Default / Page Builder form-toolbar toggle, ships the visual block editor (drag-and-drop canvas, inspector, responsive preview, query loop), and works for both code-first (`withPageBuilder()`) and UI-created collections and singles. Packaging: declares `sideEffects` so its admin components register from a plain side-effect import, with pinned peer versions for clean installs.

- Updated dependencies [[`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.31
  - @nextlyhq/adapter-mysql@0.0.2-alpha.31
  - @nextlyhq/adapter-postgres@0.0.2-alpha.31
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.31

## 0.0.2-alpha.30

### Patch Changes

- [#145](https://github.com/nextlyhq/nextly/pull/145) [`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The API reference was not correctly specified in the `useEffect` dependency array. It was set as `[api]`, whereas it should have been `[api.public]`.

- Updated dependencies [[`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.30
  - @nextlyhq/adapter-mysql@0.0.2-alpha.30
  - @nextlyhq/adapter-postgres@0.0.2-alpha.30
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.30

## 0.0.2-alpha.29

### Patch Changes

- [#143](https://github.com/nextlyhq/nextly/pull/143) [`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Extensible plugin platform — plugins are first-class, semver-protected extensions of a Nextly app, wired through a single `plugins` array in `defineConfig`.
  - **Plugin contract + SDK**: `definePlugin()` and the `plugins` array, with `@nextlyhq/plugin-sdk` as the stable, semver-protected authoring boundary (the packages stay `0.x` alpha; the SDK surface is held to the stability ladder). Boot-time dependency ordering via `dependsOn` / `optionalDependsOn`, version-range checks, and an `enabled` gate.
  - **Schema contributions**: plugins can contribute their own collections, singles, and components; `contributes.extend` adds fields to existing collections — both code-first AND UI-Builder–created ones — and cross-plugin relations resolve at boot. Plugin-owned fields carry provenance (`source`/`owner`/`locked`) and render locked + labelled in the Schema Builder so they can't be edited away.
  - **Permissions**: `contributes.permissions` registers custom permissions and role bundles that flow through the existing access-control checks.
  - **HTTP routes**: namespaced, secure-by-default plugin routes mounted under `/api/plugins/<name>/…`, with the same auth/CSRF guarantees as core routes.
  - **Admin UI contributions**: menu items, full pages, settings panels, custom views, and header/toolbar slots (show/hide defaults + inject components). Plugin admin component modules are auto-registered.
  - **Lifecycle events + filters**: an event bus plugins publish to and subscribe from, plus context filters they can transform — the basis for cache invalidation, side effects, and cross-plugin reactions.
  - **Custom field types, email providers/templates, and auth extensibility** (strategies + hooks) are all pluggable through the same contract.
  - **First-party + tooling**: ships `@nextlyhq/plugin-form-builder`, the `nextly add <package>` install-and-wire CLI command, and `create-nextly-app` plugin scaffolding.

- Updated dependencies [[`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.29
  - @nextlyhq/adapter-mysql@0.0.2-alpha.29
  - @nextlyhq/adapter-postgres@0.0.2-alpha.29
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.29

## 0.0.2-alpha.28

### Patch Changes

- [#134](https://github.com/nextlyhq/nextly/pull/134) [`0363799`](https://github.com/nextlyhq/nextly/commit/0363799c3842692ddc64d1d2ed1b548aa1958838) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Remove the hardcoded default super-admin credentials from `seedSuperAdmin()`. The seeder no longer falls back to a built-in email/password pair: callers (the `/admin/setup` wizard and the dev seed) must pass an explicit `email` and `password`, and the function throws a `VALIDATION_ERROR` if either is missing. `seedAll()` likewise fails closed when super-admin seeding is enabled but no credentials are supplied, instead of creating a known-weak default account. This removes a well-known default credential from shipped framework source.

  Also hides the placeholder address the admin user menu previously showed when a user had no email (the line is now omitted when empty), and standardizes example email placeholders across the admin and form-builder UIs onto the `nextly.local` domain.

- Updated dependencies []:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.28
  - @nextlyhq/adapter-postgres@0.0.2-alpha.28
  - @nextlyhq/adapter-mysql@0.0.2-alpha.28
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.28

## 0.0.2-alpha.27

### Patch Changes

- [#131](https://github.com/nextlyhq/nextly/pull/131) [`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Stop collections from generating orphan Drizzle `.ts` schema files.

  Creating or updating a collection (via the admin UI or `nextly db:sync`) used to write a Drizzle `.ts` schema into `src/db/schemas/dynamic/` and maintain an `index.ts` barrel. Nothing imported these files: the runtime resolves each table's Drizzle schema from the `dynamic_collections` metadata via `generateRuntimeSchema`, exactly as singles and components already do (those never generated `.ts` files). The only consumer was the raw `drizzle-kit` binary via `merge-schemas` / `drizzle-kit-entry`, which requires a `drizzle.config.ts` that the framework's own commands never invoke. The generated files therefore drifted from the database and read as dead code.

  Collections now behave like singles and components: the data table is created, the field definitions are stored in `dynamic_collections`, an in-memory runtime schema is registered, and the SQL migration is still written to `src/db/migrations/dynamic/` (it remains the durable DDL applied by `nextly migrate`). No `.ts` schema file is written.

  Changes:
  - `CollectionFileManager`: replaced `saveArtifacts`/`saveUpdateArtifacts` with a migration-only `saveMigration`; removed `updateSchemaIndex`, `removeFromSchemaIndex`, and the disk-based `reloadSchema` hot-reload.
  - `CollectionMetadataService`: create/update/delete now persist only the SQL migration. The update path relies on the existing `registerRuntimeSchema` call to refresh the in-memory table, so no on-disk reload is needed.
  - Removed the now-unused `generateSchemaCode` Drizzle code generator from `DynamicCollectionSchemaService` and the `schemaCode`/`schemaFileName` fields from `CollectionArtifacts`.
  - `nextly db:sync --schemas` no longer writes Drizzle `.ts` files; the flag now only generates Zod validation schemas.

  Also removed the unused `NEXTLY_SKIP_SCHEMA_FILES` environment toggle (it was set nowhere and only gated the now-removed file writes).

- [#126](https://github.com/nextlyhq/nextly/pull/126) [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - parseMediaRoute had no case for the 'bulk' segment, so DELETE /api/media/bulk fell through to the single-item path and treated 'bulk' as a mediaId, causing a 404 from the database.

- Updated dependencies [[`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397), [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.27
  - @nextlyhq/adapter-mysql@0.0.2-alpha.27
  - @nextlyhq/adapter-postgres@0.0.2-alpha.27
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.27

## 0.0.2-alpha.26

### Patch Changes

- [#123](https://github.com/nextlyhq/nextly/pull/123) [`6964718`](https://github.com/nextlyhq/nextly/commit/6964718c5d36dba4a337fbce1bf70a55c5554b1f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Single edit forms no longer ask for a title and slug. A Single is a one-instance document whose identity is fixed by its config (`label` + `slug`), but the admin previously rendered title and slug as editable, required inputs — forcing redundant input for values already determined by the definition.

  The single edit form now shows the title (from the single's `label`) and slug (from the configured `slug`) as read-only, non-editable fields, and submitting never errors on them. `EntrySystemHeader` and `EntryMetaStrip` gain opt-in `lockIdentity`/`lockSlug` flags (default off, so collection entry forms are unchanged); for singles the title/slug are seeded from config, the client validation for those two fields is relaxed, and slug auto-generation is disabled.

- Updated dependencies [[`6964718`](https://github.com/nextlyhq/nextly/commit/6964718c5d36dba4a337fbce1bf70a55c5554b1f)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.26
  - @nextlyhq/adapter-mysql@0.0.2-alpha.26
  - @nextlyhq/adapter-postgres@0.0.2-alpha.26
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.26

## 0.0.2-alpha.25

### Patch Changes

- [#121](https://github.com/nextlyhq/nextly/pull/121) [`8cc3a1c`](https://github.com/nextlyhq/nextly/commit/8cc3a1cccfce7bd0064d16f683022420b99f3fe8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer fail to install under pnpm 11. pnpm 11 stopped reading the `pnpm` field from `package.json`, so the `pnpm.onlyBuiltDependencies` allowlist the scaffolder emitted was ignored: `pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS`, and past that `better-sqlite3` never compiled its native binding (SQLite scaffolds crashed at boot) while `sharp`, `esbuild`, and `unrs-resolver` were silently blocked.

  The scaffolder now writes the build-script allowlist to `pnpm-workspace.yaml` instead, emitting both `allowBuilds` (read by pnpm 11+) and `onlyBuiltDependencies` (read by pnpm 10.6+), and drops the now-dead `pnpm` field from the generated `package.json`. `better-sqlite3` is always allow-listed so the `--use-yalc` dev flow — which installs every adapter — builds it too. npm, yarn, and pnpm 9 run dependency build scripts by default and ignore the file, so it is harmless under those package managers.

- Updated dependencies [[`8cc3a1c`](https://github.com/nextlyhq/nextly/commit/8cc3a1cccfce7bd0064d16f683022420b99f3fe8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.25
  - @nextlyhq/adapter-mysql@0.0.2-alpha.25
  - @nextlyhq/adapter-postgres@0.0.2-alpha.25
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.25

## 0.0.2-alpha.24

### Patch Changes

- [#103](https://github.com/nextlyhq/nextly/pull/103) [`01f3f7a`](https://github.com/nextlyhq/nextly/commit/01f3f7a22eb2e85fb6987b43264c07e993872fa7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Forward `cc`/`bcc` consistently across every email send path.

  `nextly.email.send` and `nextly.email.sendWithTemplate` (Direct API) now accept and forward `cc`/`bcc` — they are added to `SendEmailArgs` and `SendTemplateEmailArgs`. Previously the Direct API namespace silently dropped both fields, so only the REST route (`/api/email/send-with-template`) honored them. `EmailService.sendWithTemplate` also dropped `cc`/`bcc` on its code-first template fallback branch while the DB-template branch already forwarded them; both branches now forward them. Empty `cc`/`bcc` arrays are not forwarded, so they don't override the "no options" path.

- Updated dependencies [[`01f3f7a`](https://github.com/nextlyhq/nextly/commit/01f3f7a22eb2e85fb6987b43264c07e993872fa7)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.24
  - @nextlyhq/adapter-mysql@0.0.2-alpha.24
  - @nextlyhq/adapter-postgres@0.0.2-alpha.24
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.24

## 0.0.2-alpha.23

### Patch Changes

- [#101](https://github.com/nextlyhq/nextly/pull/101) [`7f7845b`](https://github.com/nextlyhq/nextly/commit/7f7845b5feeec3b30ed86ae459ef3d2347734cca) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix component CRUD breaking with a 500 after a dev-server config hot-reload.

  `reloadNextlyConfig` rebuilt the runtime Drizzle descriptors for `comp_*` data tables with the collection/single `generateRuntimeSchema`, which prepends `id`/`title`/`slug` base columns and omits the `_parent_id`/`_parent_table`/`_parent_field`/`_order` link columns that components use to reference their parent document. This overwrote the correct boot-time registration.

  After a hot-reload the bad descriptor no longer matched the physical table, so component reads (which filter by `_parent_id`) failed and were swallowed as "no rows", and component writes (which insert the `_parent_*` columns) were rejected by the database. Saving any Single or Collection document that embeds a component returned a 500.

  The reload path now builds `comp_*` descriptors with `ComponentSchemaService.generateRuntimeSchema`, matching the boot path and the physical `comp_*` table. Adds a regression test asserting the refreshed descriptor exposes the `_parent_*` link columns and not `title`/`slug`.

- Updated dependencies [[`7f7845b`](https://github.com/nextlyhq/nextly/commit/7f7845b5feeec3b30ed86ae459ef3d2347734cca)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.23
  - @nextlyhq/adapter-mysql@0.0.2-alpha.23
  - @nextlyhq/adapter-postgres@0.0.2-alpha.23
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.23

## 0.0.2-alpha.22

### Patch Changes

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`bdece5c`](https://github.com/nextlyhq/nextly/commit/bdece5c41872f0f9cb71b4fc43dca034fabdbfe5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix code-first / HMR schema applies wrongly dropping managed tables on SQLite & MySQL.

  On SQLite and MySQL, drizzle-kit's `pushSchema` ignores `tablesFilter` and introspects the whole database, so any managed table missing from the desired schema was flagged as a data-losing "orphan" DROP — failing the apply and offering the table as a spurious rename source. Three cases are fixed:
  - **Schema-events ledger (`nextly_schema_events`)** is now a first-class managed core table (declared in `getCoreSchema` / `getDialectTables` / `CORE_TABLE_NAMES`), so no schema path — apply, HMR, `migrate`, or `db:sync` — ever treats it as an orphan drop or offers it as a spurious rename target. To make it round-trip cleanly, the SQLite primary key gains an explicit `NOT NULL` (SQLite, unlike PG/MySQL, treats a bare `TEXT PRIMARY KEY` as nullable) and the SQLite partial unique index is dropped — drizzle-kit 0.31.10 cannot round-trip a SQLite partial index ([drizzle-team/drizzle-orm#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688)), and keeping it churned `DROP/CREATE INDEX` on every push. Postgres keeps its partial unique index. The "one applied row per file" guarantee is now enforced in code on all dialects: an atomic conditional `markApplied` (sets `applied` only when no other applied row exists for the filename) plus the existing cross-process migrate lock.
  - **UI-created collections, singles, and components** are now preserved during a code-first HMR apply: every DB-registered resource is included in the desired schema (code-config entries take precedence), so adding a collection in code no longer drops resources created via the admin UI.
  - **Migration status**: a collection added in code after the initial DB setup is now marked `applied` once its table is created, instead of showing `pending` forever in the builder listing (mirrors the existing singles behaviour).

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`faf14cd`](https://github.com/nextlyhq/nextly/commit/faf14cdfe644e3c0ecdb84c691289d01e6c80010) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix fresh-database first-run aborting on MySQL.

  Now that `nextly_schema_events` is a core table, `freshPushSchema` creates it (and its indexes) during first-run setup. The setup then also replayed the out-of-band `getSchemaEventsDdl` unconditionally, and the MySQL raw DDL's `CREATE INDEX` has no `IF NOT EXISTS`, so it failed with a duplicate-index error and first-run reported failure on a fresh MySQL database. The out-of-band bootstrap is now guarded by a `tableExists` check (matching `nextly migrate`'s `ensureLedger`), so it only runs as a fallback when the ledger is genuinely missing.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`17f0353`](https://github.com/nextlyhq/nextly/commit/17f0353fb0d21086171278a6f9cbf0470e9775f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` generating the wrong schema for components.

  The migration snapshot generator built component tables with the **collection** table-builder, so they came out with `slug`/`title` and were missing the component embedding columns (`_parent_id`, `_parent_table`, `_parent_field`, `_order`, `_component_type`). The generated snapshot then diverged from the real component table the apply pipeline creates, which made `nextly migrate:resolve --applied` fail its schema-match verification for any project with a component. Components now use `buildDesiredTableFromComponentFields`, matching the apply path.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7f465db`](https://github.com/nextlyhq/nextly/commit/7f465db7721381a10c458fca6cc182164c0651a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` omitting the component parent index, which broke `migrate:resolve --applied`.

  The apply pipeline always creates a composite index (`idx_<table>_parent` on `_parent_id`, `_parent_table`, `_parent_field`) for component tables, but the migration-snapshot builder did not emit it. So the live index looked like an unmanaged extra and `nextly migrate:resolve --applied` failed verification ("Live schema does not match the target snapshot") for any project with a component. The snapshot builder now emits the parent index, matching the apply pipeline.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7cae340`](https://github.com/nextlyhq/nextly/commit/7cae34051c5739bfd9afa78bf9c901a6d934b8d4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix two `nextly_schema_events` ledger edge cases on the code-first schema path.
  - **Postgres index/default churn:** the ledger's raw bootstrap DDL declared `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, but the Drizzle def supplies the value app-side (`$defaultFn`) with no SQL default. Now that the ledger is a core table flowing through drizzle-kit's Postgres diff, that mismatch made every push/migrate emit `ALTER COLUMN started_at DROP DEFAULT`. The raw DDL now omits the redundant default (matching the MySQL/SQLite ledger DDL and the `id` column), so the ledger round-trips cleanly with no churn. Added a Postgres round-trip integration test alongside the existing SQLite one.
  - **`markApplied` race no-op:** when the "one applied row per file" guard blocked a concurrent second apply, the losing row was left dangling at `in_progress` and the caller still logged a success. `markApplied` now resolves the blocked row to `superseded` and returns whether it applied, and `nextly migrate` reports the file as already-applied-by-a-concurrent-run instead of a false success.

- Updated dependencies [[`bdece5c`](https://github.com/nextlyhq/nextly/commit/bdece5c41872f0f9cb71b4fc43dca034fabdbfe5), [`faf14cd`](https://github.com/nextlyhq/nextly/commit/faf14cdfe644e3c0ecdb84c691289d01e6c80010), [`17f0353`](https://github.com/nextlyhq/nextly/commit/17f0353fb0d21086171278a6f9cbf0470e9775f4), [`7f465db`](https://github.com/nextlyhq/nextly/commit/7f465db7721381a10c458fca6cc182164c0651a4), [`7cae340`](https://github.com/nextlyhq/nextly/commit/7cae34051c5739bfd9afa78bf9c901a6d934b8d4)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.22
  - @nextlyhq/adapter-mysql@0.0.2-alpha.22
  - @nextlyhq/adapter-postgres@0.0.2-alpha.22
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.22

## 0.0.2-alpha.21

### Patch Changes

- [#84](https://github.com/nextlyhq/nextly/pull/84) [`0e17fc6`](https://github.com/nextlyhq/nextly/commit/0e17fc6c3b4863552380729d61f938049e15ca1e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified schema-migration pipeline with `ui-schema.json` dual-write.
  - **Migration CLI**: `migrate:create` / `migrate` / `migrate:check` / `migrate:status`, plus `migrate:down` for forward-resolved rollbacks (DOWN SQL generated at create time, renames preserved). A pooler-safe TTL migration lock replaces the session advisory lock that leaked through Neon's PgBouncer, and production deployments can run pending migrations on boot (`db.runMigrationsOnBoot` + `db.migrateLockTtlSeconds`).
  - **`ui-schema.json` dual-write**: the admin Schema Builder always applies changes to the dev database AND writes a committable `ui-schema.json` (the file-only mode is retired). The manifest is now a lossless record of every field option the builder/code-first can set — full validation (min/max length, pattern, etc.), per-field admin (width, description, placeholder…), `unique`, `index`, labels, the Draft/Published `status` flag (persisted from both the field-change and settings-only save paths), and polymorphic `relationTo` arrays (previously truncated to the first target). The `toggle` field type round-trips correctly.
  - **Correct column types**: `migrate:create` no longer flattens fields before diffing, so hasMany and polymorphic relationships emit `json` columns instead of a single `text` id column.
  - **Diffable index/unique migrations** (Postgres/MySQL/SQLite): field `unique`/`index`, single-relationship auto-indexes, and the system slug/created_at indexes are now diffed and emitted (`CREATE`/`DROP INDEX`) with live-DB introspection, down-migration support, and a backward-compat sentinel so pre-existing tables don't churn.
  - **Cleanup**: removed the unused `verification_tokens` table (a leftover from the retired Auth.js integration; custom auth uses `email_verification_tokens` and `password_reset_tokens`). `dev:reset` auto-detects the dialect from `DATABASE_URL`, and the ui-schema field-type set was widened to the full canonical list.

- Updated dependencies [[`0e17fc6`](https://github.com/nextlyhq/nextly/commit/0e17fc6c3b4863552380729d61f938049e15ca1e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.21
  - @nextlyhq/adapter-mysql@0.0.2-alpha.21
  - @nextlyhq/adapter-postgres@0.0.2-alpha.21
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.21

## 0.0.2-alpha.20

### Patch Changes

- [#63](https://github.com/nextlyhq/nextly/pull/63) [`f721539`](https://github.com/nextlyhq/nextly/commit/f721539a8ee9cccfcd179e1bc96de0863a160345) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Singles builder popup now auto-derives the slug as kebab-case to match the web convention used by public routes and the entry-form slug validator. Typing `About Page` as the singular name now fills the slug as `about-page` instead of `about_page`. Collections and components keep their existing snake_case defaults so their backend validators continue to accept the auto-generated value unchanged. The shared `BuilderSettingsModal` forwards the per-kind identifier to `BasicsTab`, where the slug-case helper is selected; a new `toKebabName` helper lives alongside `toSnakeName` in `@admin/lib/builder` for downstream consumers that need URL-friendly identifiers.

  `create-nextly-app` now resolves the published `@nextlyhq/ui` and `@nextlyhq/plugin-form-builder` versions from the npm registry alongside the other `@nextlyhq/*` packages it scaffolds. Generated `package.json` files pin both via their published semver range instead of falling back to `"latest"`, so fresh projects install the same versions the CLI was tested against.

- Updated dependencies [[`f721539`](https://github.com/nextlyhq/nextly/commit/f721539a8ee9cccfcd179e1bc96de0863a160345)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.20
  - @nextlyhq/adapter-mysql@0.0.2-alpha.20
  - @nextlyhq/adapter-postgres@0.0.2-alpha.20
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.20

## 0.0.2-alpha.19

### Patch Changes

- [#61](https://github.com/nextlyhq/nextly/pull/61) [`e2b4131`](https://github.com/nextlyhq/nextly/commit/e2b4131f63f4de10587772717d707a0a61ce62f9) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Admin UI polish across the Entries forms, Schema Builder, sidebar, and global loaders.

  Field width is now respected end-to-end. `packFieldsIntoRows` no longer treats `group` as a block-only field, so groups participate in the same row-packing as regular fields and honour `admin.width` on both the builder canvas and the entry form. `FieldRow` adds a synthetic spacer column when a row's declared widths sum to less than 100% so partial-width fields keep their authored size instead of stretching to fill, and uses `items-start` so adjacent fields of different heights align cleanly. `NestedFieldGroup` in the schema builder uses the shared `packIntoRows` / `parseWidth` helpers to render nested children in the same row layout as the top-level canvas; `repeater` and `group` containers are forced to full width to stay readable. `ComponentRow` and `GroupInput` now delegate to `FieldRow` + `packFieldsIntoRows` instead of mapping each child through `FieldRenderer` directly, so nested component and group fields lay out consistently with the surrounding form. `pack-fields-into-rows` also guards against `undefined` / non-array `fields` input.

  Entries table no longer shows the `id` column by default. `getDefaultVisibleColumns` keeps `id` available in the column toggler but excludes it from the initial visible set, matching the rest of the admin's "title first" presentation.

  Schema Builder toolbar is now sticky. `BuilderToolbar` sticks to the top of the builder viewport (`sticky top-0 z-30`) with a solid background so it stays visible while scrolling long field lists; the collection / single / component builder pages were restructured to render the toolbar outside `PageContainer` so the sticky positioning has the correct scroll parent, and the container drops its bottom padding to remove the gap underneath.

  Sidebar no longer flashes the empty / unauthorised state during hydration. `DualSidebar` now treats `!isHydrated` as part of `hasPermissionDataPending` (alongside the existing permissions-loading / error checks), so menu groups render their loading skeletons until the router and permissions are both ready instead of briefly showing nothing.

  `PermissionGuard` loading state is replaced with a branded loader: a glassmorphic card with an ambient glow, the shared `Spinner`, and the Nextly brand mark animated via two new global keyframes (`brand-orbit`, `brand-pulse`) added to `globals.css`. A `?debug_loading=true` query param force-enables the loading view to make iteration on the loader easier. Auth setup / reset-password / user-management / email-provider secret-field inputs get small consistency tweaks alongside the same loader treatment.

- Updated dependencies [[`e2b4131`](https://github.com/nextlyhq/nextly/commit/e2b4131f63f4de10587772717d707a0a61ce62f9)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.19
  - @nextlyhq/adapter-mysql@0.0.2-alpha.19
  - @nextlyhq/adapter-postgres@0.0.2-alpha.19
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.19

## 0.0.2-alpha.18

### Patch Changes

- [#55](https://github.com/nextlyhq/nextly/pull/55) [`de3ec7e`](https://github.com/nextlyhq/nextly/commit/de3ec7e941eb3c7fc33df9dc403e0c5a5135c0b0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Three related singles / API consistency fixes.

  REST responses for collections previously included both snake_case (`created_at`, `updated_at`) and camelCase (`createdAt`, `updatedAt`) variants of the system timestamp fields. The conversion helper added the camelCase aliases but never removed the snake_case originals, so list and detail endpoints surfaced duplicate keys per row. The snake-to-camel conversion now lives in a single helper, `convertTimestampsToCamelCase`, exported from `shared/lib/case-conversion.ts` next to the existing `keysToCamelCase` / `keysToSnakeCase` utilities. Both `collection-query-service` and the singles `deserializeJsonFields` path call it directly. The previous `withTimestampAliases` wrapper and its re-export from `domains/collections/index.ts` are removed. Collections responses now match singles / media / users / api-keys / uploads, which already emitted the camelCase form only.

  The admin sidebar's singles list now renders every single in the project rather than capping at the `useSingles()` default page size of 10. `DynamicSingleNav` drives a `useInfiniteQuery` against the singles endpoint and walks subsequent pages while `meta.hasNext` is true. Each request is bounded to 100 rows so per-request DB load stays small. Secondary consumers that derive visibility or grouping data from the singles list (`DualSidebar`, `DynamicCustomGroupNav`, `SinglesLandingRedirect`) now pass an explicit `pageSize: 100` to `useSingles`, matching the pattern already used by the collections sidebar fetch. This stops the same truncation symptom from hiding section headers or misrouting the `/admin/singles` landing redirect when the project has more than 10 singles.

  The `GET /admin/api/singles` handler now accepts a 1-based `page` query parameter as an alternative to `offset`. The admin UI's shared `buildQuery` helper emits `page` for every paginated route; previously the singles endpoint read only `offset`, so a page change in the Singles builder table left the offset at 0 and the same first page was returned for every navigation. When both `offset` and `page` are supplied `offset` wins, preserving the existing external API contract.

- Updated dependencies [[`de3ec7e`](https://github.com/nextlyhq/nextly/commit/de3ec7e941eb3c7fc33df9dc403e0c5a5135c0b0)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.18
  - @nextlyhq/adapter-mysql@0.0.2-alpha.18
  - @nextlyhq/adapter-postgres@0.0.2-alpha.18
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.18

## 0.0.2-alpha.17

### Patch Changes

- [#56](https://github.com/nextlyhq/nextly/pull/56) [`4d7b4f7`](https://github.com/nextlyhq/nextly/commit/4d7b4f76a4a697fd98b7f98e784179a3fe100c8f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix the schema-apply pipeline silently skipping column type changes on Postgres, leaving the live DB permanently drifted while the journal still recorded the apply as successful.

  **The bug, end-to-end.** When a Builder field was reclassified from a text-like type (`text`, `richText`, `textarea`) to a JSON-backed type (`group`, `repeater`, `blocks`, `json`, `chips`, `point`), the diff engine produced a `change_column_type` operation (`text` → `jsonb` on Postgres). That op type was not in the fast in-memory DDL emitter's allow-list, so the pipeline fell back to `drizzle-kit`'s `pushSchema`. `pushSchema` considers `text` → `jsonb` a non-implicit cast and, in programmatic (non-TTY) mode, omits the `ALTER COLUMN … SET DATA TYPE` statement from `statementsToExecute`, returning the omission only in `warnings`. The pipeline ran the (now-empty or partial) statement list, hit no error, and the migration journal recorded `status='success'`. The next preview compared the live `text` column to the desired `jsonb` token from `field-column-descriptor` and re-detected the same drift — forever. A site running on Neon (rext-site-v2 / `dc_case_studies`) ended up with 10 columns stuck on `text` after three "successful" UI applies on 2026-05-20.

  **The fix.** Four complementary changes in `domains/schema/pipeline/`:
  1. The fast in-memory DDL emitter now owns `change_column_type`, `change_column_nullable`, and `change_column_default` on Postgres. `change_column_type` emits `ALTER TABLE … ALTER COLUMN … SET DATA TYPE <toType> USING "<col>"::<toType>` — the explicit `USING` cast covers the cross-family transitions that Postgres refuses to do implicitly (including the `text` → `jsonb` case), and Postgres errors loudly at execution when no registered cast exists between the source and target types. `change_column_nullable` emits `SET NOT NULL` / `DROP NOT NULL` per the `toNullable` value. `change_column_default` emits `SET DEFAULT <expr>` (raw expression, owned by `build-from-fields`) or `DROP DEFAULT` when `toDefault === undefined`. The three op types are added to `FAST_PATH_OP_TYPES` so they never reach drizzle-kit on Postgres again.
  2. The code-first SQL template at `sql-templates/postgres.ts` (consumed by `nextly migrate:create`) now emits the same `USING "<col>"::<toType>` clause for `change_column_type`. Without this, code-first projects on Postgres would have produced a `.sql` file in the repo whose `ALTER COLUMN … TYPE jsonb` failed at `nextly migrate` apply time in CI — the same drift loop as the Builder UI path, just deferred to migration-apply time. Both consumer surfaces (the apply pipeline and the migration-file generator) now share the same `USING` contract.
  3. Empty op lists on Postgres now also take the fast path (which emits nothing) instead of falling through to drizzle-kit. Letting drizzle-kit handle a "no ops" apply meant it ran its own catalog re-introspection and rename heuristics against the full live DB, and emitted destructive DDL that the diff engine had explicitly decided was not needed. The textarea→richText regression on rext-site-v2 / `test_verify_fix` surfaced this: both field types map to a `text` column on Postgres, so the diff produced zero column-level ops, but the slow path then attempted `DROP INDEX "single_pricings_pkey"` for an unrelated managed table, which Postgres rejects because a primary-key index cannot be dropped directly. Trusting our own diff for "no DDL is needed" closes that surface entirely.
  4. A safety net for the slow path (MySQL / SQLite, where the in-memory emitter does not apply, or any future op type that hasn't yet been added to the fast path). After `kit.pushSchema(...)` returns, the pipeline now inspects `pushResult.warnings`; when drizzle-kit declined any statement the apply throws a `PushSchemaError` carrying the warning text, so the journal correctly records a failed apply rather than a false success. Operators see the precise drizzle-kit message instead of an invisible silent skip, and the next apply will not re-detect the same phantom drift.

  Affected sites running on a published `0.0.2-alpha.0` … `0.0.2-alpha.16` still need a one-time `ALTER TABLE … ALTER COLUMN … SET DATA TYPE jsonb USING …` to relabel columns that were created as `text` during the silent-skip window; the fix prevents NEW drift but does not retroactively repair existing tables (running an Apply through the Builder after upgrading does the relabel automatically). Unit tests cover the three new emitter cases (including identifier-quoting through the `USING` clause), the routing-eligibility decisions for each (including the empty-ops case), and the safety-net throw path with a representative drizzle-kit warning payload.

- Updated dependencies [[`4d7b4f7`](https://github.com/nextlyhq/nextly/commit/4d7b4f76a4a697fd98b7f98e784179a3fe100c8f)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.17
  - @nextlyhq/adapter-mysql@0.0.2-alpha.17
  - @nextlyhq/adapter-postgres@0.0.2-alpha.17
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.17

## 0.0.2-alpha.16

### Patch Changes

- [#52](https://github.com/nextlyhq/nextly/pull/52) [`9bc10b6`](https://github.com/nextlyhq/nextly/commit/9bc10b6b548974a1e4c49ed4c9ec1e0902536f37) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix `update operation failed on table '<table>': value.toISOString is not a function` when saving a Single document or a component instance that includes a date field. JSON request bodies deliver date values as ISO strings (e.g. `"2026-05-20T12:22:29.417Z"`), but Drizzle binds `timestamp` columns by calling `.toISOString()` on the bound value -- so an unmodified string travelling through the adapter blows up at the driver layer. `CollectionMutationService` already coerced date strings into `Date` objects inline at every write site, but the equivalent step was missing from `SingleMutationService.update` and from `ComponentMutationService.serializeComponentRow` (which feeds every insert / update path in the component service via `buildInsertRow` and direct calls).

  A new `coerceDateFieldsToDate(data, fields)` helper in `shared/lib/field-transform.ts` mutates the row in place, converting string values for `field.type === "date"` columns into `Date` objects. Existing `Date`, `null`, and `undefined` values pass through untouched, so the function is idempotent and safe to call on rows that were coerced upstream. The signature accepts a structural `ReadonlyArray<{ name?: string; type?: string }>` so the same helper covers both `FieldConfig[]` (singles, components) and the runtime `FieldDefinition[]` (collections). The helper is wired into `single-mutation-service.update` before snake-casing the row and into `component-mutation-service.serializeComponentRow` before column mapping. The six inline copies of the same coercion block in `collection-mutation-service.ts` were collapsed onto the shared helper as part of the same change so there is one implementation across all three domains. Result: PATCH `/admin/api/singles/<slug>` with a `date` field, inserts / updates on components with date fields, and the existing collection flows that already worked all succeed against Postgres, MySQL, and SQLite. Unit tests cover the helper's coercion, idempotency, null / undefined pass-through, and no-touch behaviour for non-date fields.

- Updated dependencies [[`9bc10b6`](https://github.com/nextlyhq/nextly/commit/9bc10b6b548974a1e4c49ed4c9ec1e0902536f37)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.16
  - @nextlyhq/adapter-mysql@0.0.2-alpha.16
  - @nextlyhq/adapter-postgres@0.0.2-alpha.16
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.16

## 0.0.2-alpha.15

### Patch Changes

- [#51](https://github.com/nextlyhq/nextly/pull/51) [`ab23486`](https://github.com/nextlyhq/nextly/commit/ab234866888691751f6baa7738a854624f86dbbd) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix users created through the admin "Create user" page being unable to sign in, and clear up the misleading checkbox that caused the silent failure in the first place.

  The form's submit handler in `packages/admin/src/pages/dashboard/users/create.tsx` collected the "Active Account" checkbox value into `values.active` but never forwarded it to the API, so the backend always saw `isActive` as `undefined` and fell back to its default of `false`. `verify-credentials.ts` rejects inactive accounts at every login leg, so the newly-created user could authenticate with the right password and still see a generic "invalid credentials" error. The submit handler now sends `isActive: values.active ?? true`, matching the checkbox's documented "Default: Yes" UX. The backend default of `false` is intentionally preserved -- it is load-bearing for self-registration via `/auth/register`, where `auth-service.verifyEmail` is what flips `isActive` to `true` and gates login on proof of email ownership.

  The companion checkbox was also reworked. It was labeled "Send Welcome Email" with help text "Send an email with login credentials after account creation", but it actually sets `emailVerified: null` and dispatches a _verification_ email -- the user could not sign in until they clicked the link. Combined with the form's "Active: Yes" default, that meant the out-of-the-box "create user" flow promised immediate login but silently delivered the opposite. The form field is now named `requireEmailVerification`, the label is "Require Email Verification", the help text is honest about the verification gate, the default is unchecked (so the form's "Active + immediate login" promise holds end-to-end), the checkbox is disabled when the account is inactive (verification is meaningless for a disabled account), and an inline note surfaces when both flags are on so the admin understands login is still gated until the verification link is clicked. The wire shape is unchanged -- `requireEmailVerification` maps onto the historical `sendWelcomeEmail` field at submit time so existing API consumers keep working.

- Updated dependencies [[`ab23486`](https://github.com/nextlyhq/nextly/commit/ab234866888691751f6baa7738a854624f86dbbd)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.15
  - @nextlyhq/adapter-mysql@0.0.2-alpha.15
  - @nextlyhq/adapter-postgres@0.0.2-alpha.15
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.15

## 0.0.2-alpha.14

### Patch Changes

- [#49](https://github.com/nextlyhq/nextly/pull/49) [`ea7fbe5`](https://github.com/nextlyhq/nextly/commit/ea7fbe5d2b0071304db50a8da835a91dd90a94ed) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix two related admin-auth failures that surface on hosted databases (Neon, Supabase, PlanetScale, etc.) during transient DB hiccups.

  **Login/setup fluctuation.** The `getUserCount` dependency in the auth handler bridge used to swallow any DB error and return `0`, which made `GET /auth/setup-status` reply `{ isSetup: false }` whenever a pool cold-start, brief disconnect, or failover landed on this endpoint — the admin route guards then redirected the user to `/admin/setup`, the next call returned `{ isSetup: true }` once the DB recovered, and the guards redirected back to `/admin/login`, oscillating until the next hiccup or full page reload. The user count is the bootstrap-gate for two security-relevant decisions (setup-status reporting and the first-admin pre-check), and treating an unknown count as zero also opened a window where a transient DB failure during `POST /auth/setup` could allow a second super-admin to be created while the real first user was briefly invisible to the query. `getUserCount` now propagates errors; `handleSetupStatus` and `handleSetup` catch them, emit a canonical `503 SERVICE_UNAVAILABLE` envelope through the shared `buildAuthErrorResponse` helper (`application/problem+json` + `x-request-id`), and log a structured operator event (`setup-status-failed` / `setup-precheck-failed`). The admin's `PrivateRoute` and `PublicRoute` now consume a shared `lib/auth/setup-status.ts` module that fail-safes to "setup complete" on any failure (network error, 5xx, invalid response shape) — staying on the dashboard or login screen is recoverable on the next request, whereas dragging an authenticated user into the setup wizard is destructive. `useCurrentUserPermissions` is gated by `routeType === "private"` so its `refetchOnWindowFocus` cannot fire `/me/permissions` during a brief Suspense window on a public route.

  **Intermittent logout around the access-token TTL boundary.** The same swallow-and-return-null pattern lived in `findUserById`, which the refresh handler called after deleting the old refresh token. A momentary DB hiccup at the 15-minute boundary returned `null` from the lookup, the handler interpreted that as "user is gone" and ran `clearAndDeny` — clearing both auth cookies and revoking the still-valid session. `findUserById` now propagates errors; `handleRefresh` was reordered so all read-only lookups (`findUserById`, `fetchRoleIds`, `fetchCustomFields`) run BEFORE the destructive `deleteRefreshToken`, and is wrapped in a try/catch that returns `503 SERVICE_UNAVAILABLE` on any DB failure with cookies and tokens intact — the client retries on the next request and the session survives. The admin's `refreshAccessToken` was a boolean primitive that treated every non-200 response (5xx, network errors, our new 503) as "session invalid" and redirected to login; it now returns a tri-state (`ok` / `auth_failed` / `transient`) so `authFetch` only redirects on a genuine 401 from `/auth/refresh` and surfaces transient server errors to the caller without logging the user out.

  Internal: consolidated four identical `build{Login,Register,Forgot,Setup}ErrorResponse` helpers into a single `buildAuthErrorResponse` in `handler-utils.ts`, fixed a long-standing `change-password` test mock missing `auditLog`/`trustProxy`/`trustedProxyIps`, and added regression tests covering the 503 path on both setup endpoints, the refresh-handler 503 path (asserting no cookie clearing and no token deletion), and the "no super-admin is created when the pre-check throws" security invariant.

- Updated dependencies [[`ea7fbe5`](https://github.com/nextlyhq/nextly/commit/ea7fbe5d2b0071304db50a8da835a91dd90a94ed)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.14
  - @nextlyhq/adapter-mysql@0.0.2-alpha.14
  - @nextlyhq/adapter-postgres@0.0.2-alpha.14
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.14

## 0.0.2-alpha.13

### Patch Changes

- [#46](https://github.com/nextlyhq/nextly/pull/46) [`f943cb3`](https://github.com/nextlyhq/nextly/commit/f943cb32b94dffedf98a7e922f3c44338c042782) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified upload validation across both upload paths. `/api/media` now applies the same filename hygiene, extension blocklist, MIME allowlist, magic-byte sniff, and SVG sanitization that `/admin/api/collections/[slug]/uploads` already had — previously the global Media endpoint accepted any MIME type and any byte content up to 10MB with no sanitization. Validation logic is extracted into `services/upload-validation/`, both `UploadService` and `MediaService` call its `validateAndSanitizeUpload` entrypoint, and every validation failure now throws `NextlyError.validation` with a stable machine code (`FILENAME_INVALID`, `EXTENSION_BLOCKED`, `MIME_BLOCKED`, `MIME_NOT_ALLOWED`, `SIZE_EXCEEDED`, `MAGIC_BYTE_MISMATCH`, `SVG_SANITIZATION_FAILED`, `UNSUPPORTED_FOR_BACKEND`). The SVG sanitizer is tightened from `USE_PROFILES: { svg, svgFilters }` alone to explicit `FORBID_TAGS` (`foreignObject`, `animate*`, `image`, `iframe`, `object`, `embed`, `audio`, `video`, `source`, `track`, `style`) plus `FORBID_ATTR` (event handlers, `formaction`, `xlink:show`/`actuate`) and an `uponSanitizeAttribute` hook that strips any `href`/`xlink:href` whose value isn't fragment-only (`#id`). DOCTYPE declarations are stripped before sanitization to defang XML billion-laughs entity expansion, and a 2MB SVG-specific size cap is enforced separately from the general per-file limit. The magic-byte check closes a real polyglot bypass: claiming `image/svg+xml` with non-SVG bytes (or claiming a non-SVG type with XML bytes) is now rejected before the sanitizer runs.

  Breaking: `UploadService.upload()` now throws `NextlyError.validation` on validation failures instead of returning `{ success: false, errors, … }` — storage-layer 5xx failures still return the result-shape. `/api/media` rejects files outside the default MIME allowlist (override via `security.uploads.allowedMimeTypes` or `additionalMimeTypes`). SVG uploads with `<foreignObject>`, external `href`, animations, `<style>` blocks, or `data:` URIs will have those elements stripped — sanitized output may differ from input. `@nextlyhq/storage-vercel-blob` now supports SVG uploads (previously refused). The adapter returns Vercel Blob's `downloadUrl` (the file URL with `?download=1` appended) when the upload requests `contentDisposition: "attachment"`, so direct top-level navigation forces an attachment download while `<img src>` rendering remains unaffected. HTML uploads continue to be rejected with `NextlyError.validation` (code `UNSUPPORTED_FOR_BACKEND`, HTTP 415) — they're unsafe to host on a shared blob CDN regardless of disposition. `storage-local` cannot set per-file headers via Next.js static serving; sanitization still runs so stored bytes are safe, but self-hosters who want strict response headers should serve through a CDN with a response-header policy.

  A new structured event `nextly.upload.rejected` is emitted on every validation failure with `{ code, route, mimeType, filename, size }` so operators can alert on attack-pattern spikes (sudden bursts of `MAGIC_BYTE_MISMATCH` or `EXTENSION_BLOCKED` indicate polyglot probing).

  Build/dependency: the `pnpm.overrides` block now bumps `undici` to `^7` to fix a pre-existing latent runtime bug — `jsdom@28` (a transitive dep of `isomorphic-dompurify`) requires `undici@7+`'s `lib/handler/wrap-handler.js`, but the workspace was resolving `undici@6.25.0`. Any SVG upload through the existing pipeline would have crashed in production; no test exercised that path so it was undetected.

- Updated dependencies [[`f943cb3`](https://github.com/nextlyhq/nextly/commit/f943cb32b94dffedf98a7e922f3c44338c042782)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.13
  - @nextlyhq/adapter-mysql@0.0.2-alpha.13
  - @nextlyhq/adapter-postgres@0.0.2-alpha.13
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.13

## 0.0.2-alpha.12

### Patch Changes

- [#43](https://github.com/nextlyhq/nextly/pull/43) [`bbecc0d`](https://github.com/nextlyhq/nextly/commit/bbecc0d6eb91d751d49e5a4f892300d6928be015) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer crash at boot under pnpm 10+. pnpm 10 blocks dependency install scripts by default, and without an allowlist `better-sqlite3` never built its native binding, so SQLite scaffolds threw `Could not locate the bindings file` on the first admin request. `sharp`, `esbuild`, and `unrs-resolver` were silently blocked too, producing a slow JS image fallback, drizzle-kit slowness, and an eslint resolver warning respectively. The scaffolder now emits `pnpm.onlyBuiltDependencies` in the generated `package.json`: `sharp`, `esbuild`, and `unrs-resolver` always, plus `better-sqlite3` when the SQLite adapter is selected. npm, yarn, and bun ignore the `pnpm`-namespaced field, so it is harmless under those package managers.

- Updated dependencies [[`bbecc0d`](https://github.com/nextlyhq/nextly/commit/bbecc0d6eb91d751d49e5a4f892300d6928be015)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.12
  - @nextlyhq/adapter-mysql@0.0.2-alpha.12
  - @nextlyhq/adapter-postgres@0.0.2-alpha.12
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.12

## 0.0.2-alpha.11

### Patch Changes

- [#41](https://github.com/nextlyhq/nextly/pull/41) [`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix drizzle-kit rename TUI ("Is `dc_posts` table created or renamed from another table?") firing on SQLite and MySQL after the schema-apply scope-reduction landed. The scope-reduction filter iterated by managed-table names and stripped the static system tables that `buildDrizzleSchema` injects so drizzle-kit's diff recognises them. On SQLite/MySQL drizzle-kit ignores `tablesFilter`, so the missing system tables looked like drops, paired with the managed adds, and produced the rename TUI on every fresh-install boot — crashing Next.js's non-TTY server thread. The scope-reduction filter now preserves non-managed entries via `!isManagedTable(name)`, restoring the injection's intended effect on every dialect.

- Updated dependencies [[`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.11
  - @nextlyhq/adapter-mysql@0.0.2-alpha.11
  - @nextlyhq/adapter-postgres@0.0.2-alpha.11
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.11

## 0.0.2-alpha.10

### Patch Changes

- [#38](https://github.com/nextlyhq/nextly/pull/38) [`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix: variant URLs in populated `media.sizes[*].url` are now absolutized too. The initial absolutization pass only rewrote the top-level `url` and `thumbnailUrl` fields, so on SQLite — which stores `media.sizes` as TEXT and returns the column as an unparsed JSON string — clients consuming `getMediaVariant(media, "card")` on populated entries still received relative `/uploads/...` paths. `absolutizeMediaUrls` now normalises string-encoded sizes into an object before rewriting variant URLs, so populated media on entry responses returns reachable variant URLs across every dialect. Unparseable JSON resolves to `null` rather than leaking the raw string to the API consumer.

  Also: `toAbsoluteMediaUrl` and `absolutizeMediaUrls` resolve `baseUrl` lazily — the env-backed default fires only when a relative URL actually needs prefixing. Pass-through cases (absolute URLs, null/undefined/empty) no longer touch the env proxy, so the "absolute URLs unchanged" contract holds in contexts that have not booted env validation (isolated tests, bundler-time analysis).

- Updated dependencies [[`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.10
  - @nextlyhq/adapter-mysql@0.0.2-alpha.10
  - @nextlyhq/adapter-postgres@0.0.2-alpha.10
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.10

## 0.0.2-alpha.9

### Patch Changes

- [#36](https://github.com/nextlyhq/nextly/pull/36) [`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media URLs returned from the API are now absolute. Previously, the local storage adapter wrote `/uploads/...` paths and surfaced them verbatim in API responses — mobile clients, edge workers, and any consumer without the deployment's origin baked in could not resolve the URL. Now, `MediaService` responses, populated `media` relations on entry responses, and the collection upload handlers (`POST` / `GET /admin/api/collections/<slug>/uploads`) prefix relative URLs with `NEXT_PUBLIC_APP_URL` (priority: `emailConfig.baseUrl` override > `NEXT_PUBLIC_APP_URL` > `http://localhost:3000` in dev). Cloud-adapter URLs (S3, Vercel Blob, R2) are already absolute and pass through unchanged. Consumers that previously concatenated the base URL themselves should drop the prefix — double-prefix detection is in place, but the new behaviour means the prefix is no longer needed. The env schema already requires `NEXT_PUBLIC_APP_URL` in production, so the localhost fallback is only reachable in development.

  Internal: extracted a shared `getBaseUrl(override?)` helper at `src/shared/lib/get-base-url.ts` so the email service and the new media-absolutization path resolve through one priority chain. `EmailService.getBaseUrl` and the new `getMediaBaseUrl` both delegate to it.

- Updated dependencies [[`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.9
  - @nextlyhq/adapter-mysql@0.0.2-alpha.9
  - @nextlyhq/adapter-postgres@0.0.2-alpha.9
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.9

## 0.0.2-alpha.8

### Patch Changes

- [#34](https://github.com/nextlyhq/nextly/pull/34) [`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix severe Builder slowness and connection-pool exhaustion when running Nextly against Neon Postgres, and complete the code-first column-delete workflow. Adapter now wires the provider's declared `statementTimeoutMs` into `pg.Pool` (Neon's 30s default was previously ignored, letting stuck queries pin pool slots forever) and bumps Node 20+'s 250 ms Happy Eyeballs per-address timeout floor to 5 s on first connect so transcontinental Neon endpoints stop surfacing `ETIMEDOUT` after exhausting every resolved address. `DB_POOL_MAX`/`MIN`/`IDLE_TIMEOUT`/`QUERY_TIMEOUT` env vars were always documented but never plumbed into the factory — they now flow through with per-field `??` fallback so each value can fall back to the adapter's dialect-specific defaults (notably the PG adapter's `min: 0` for Neon auto-suspend recovery). Boot/HMR drift-check now uses bounded concurrency (3 workers) instead of unbounded `Promise.all` that saturated a Neon pool of 5 with 10+ collections. HMR `serverComponentChanges` events get a 300 ms trailing debounce so editor burst-saves stop firing a full pipeline per save. A short-lived live-snapshot cache deduplicates the two `introspectLiveSnapshot` calls that previously fired during a single Builder apply, and a missing `instrumentation.ts` warning surfaces in dev to nudge users toward the single-worker warmup pattern. A new fast in-memory DDL emitter on PostgreSQL bypasses drizzle-kit's ~10 s catalog re-introspection for the common Builder op set (`add_column`, `add_table`), and even on the slow-path fallback the pushSchema call is now scoped to only the table(s) actually touched by the resolved ops rather than every managed table. `filterUnsafeStatements` also blocks orphan `DROP SEQUENCE` / `DROP INDEX` whose inferred owner table is not in the desired schema. A new diff-time default normaliser collapses Postgres's redundant `::<type>` cast suffix (e.g. `'draft'::character varying`) and lowercases `now()` so the diff stops emitting phantom `change_column_default` ops for every system column on every apply; a long-standing descriptor drift between `runtime-schema-generator` and `field-column-descriptor` (status `text` vs `varchar`, missing `now()` defaults on `created_at`/`updated_at`) is also fixed so the new fast path actually triggers in the real Builder flow. End-to-end on a real Neon instance: Builder Save HTTP timing drops from ~11 s to ~5 s and the in-pipeline schema apply drops from ~10 s to ~1.4 s. Code-first column deletes now flow through a new `destructive_drop` `ClassifierEvent` that the `ClackTerminalPromptDispatcher` renders as a `Drop "<column>" from "<table>"?` confirm in the dev terminal — removing a field from `nextly.config.ts` and saving prompts you to confirm before destroying data, matching Drizzle Kit's `push` UX; `NEXTLY_ALLOW_CODE_FIRST_DROPS=1` auto-confirms every drop without prompting for CI/non-interactive workflows. Finally, the API Playground response viewer no longer crashes with "Unrecognized extension value" — the admin bundle was loading two copies of `@codemirror/state` (6.5.3 + 6.6.0) which broke `instanceof Extension`; a `pnpm.overrides` pin forces a single resolution.

- Updated dependencies [[`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.8
  - @nextlyhq/adapter-mysql@0.0.2-alpha.8
  - @nextlyhq/adapter-postgres@0.0.2-alpha.8
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.8

## 0.0.2-alpha.7

### Patch Changes

- [#32](https://github.com/nextlyhq/nextly/pull/32) [`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal refactor: consolidate the `packages/nextly/src/services/auth/` shim layer. The shim was a directory of one-line `export *` re-exports left over from an earlier reorganisation; the canonical code already lived in `packages/nextly/src/domains/auth/services/`. The shim directory has been removed and 29 internal call sites have been pointed at the canonical location. A duplicate test suite of 13 files (mechanical-path-only drift, no logic divergence) has been deleted in favour of the existing copies under `domains/auth/__tests__/`. A new `@nextly/domains/*` TypeScript path alias is added to match the existing `@nextly/services/*` / `@nextly/auth/*` pattern. No public exports, runtime behaviour, or wire-format changes; this is shipped as a patch because every package version moves together in the alpha train.

- [#30](https://github.com/nextlyhq/nextly/pull/30) [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `create-nextly-app` now prompts for a folder name when none is given on the command line. Previously, running `npx create-nextly-app` with no positional argument was silently treated as "install in the current directory" and then aborted with a `Directory not empty` error once the user finished the template and database prompts. The CLI now asks `What should your project be called?` with `my-nextly-app` pre-filled. You can accept the default with Enter, type any folder name, or type `.` (or `./`) to install in the current directory, matching the way the positional argument already worked. When the chosen target directory is non-empty the CLI now offers a three-option recovery prompt (cancel, remove existing files and continue, or ignore files and continue) instead of aborting outright. The `remove` option preserves any `.git` directory so existing history is kept.

  Note for scripted or CI use: the no-argument form is no longer equivalent to `npx create-nextly-app .`; it now opens an interactive prompt. If you were relying on the previous behavior in a non-interactive environment, pass `.` (or any folder name) explicitly.

- Updated dependencies [[`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4), [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.7
  - @nextlyhq/adapter-mysql@0.0.2-alpha.7
  - @nextlyhq/adapter-postgres@0.0.2-alpha.7
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.7

## 0.0.2-alpha.6

### Patch Changes

- [#28](https://github.com/nextlyhq/nextly/pull/28) [`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `Cannot find package '@nextlyhq/plugin-form-builder'` on `pnpm dev` for blank scaffolds. The base admin page (`templates/base/src/app/admin/[[...params]]/page.tsx`) and the existing-project admin generator both hard-coded three side-effect imports for `@nextlyhq/plugin-form-builder`, but the package was only added to `package.json` on the fresh-scaffold npm path. Blank scaffolds and existing-project installs got the imports without the dep, so `next dev` failed at module resolution. The plugin is now opt-in per template: blank ships a plugin-less admin page; the blog template overlays a blog-specific admin page that re-adds the imports (mirroring how `formBuilderPlugin` is registered only in the blog config). `generatePackageJson` and the yalc paths in `installDependencies` accept a `projectType` and only include `@nextlyhq/plugin-form-builder` when the selected template uses it.

- Updated dependencies [[`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.6
  - @nextlyhq/adapter-mysql@0.0.2-alpha.6
  - @nextlyhq/adapter-postgres@0.0.2-alpha.6
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.6

## 0.0.2-alpha.5

### Patch Changes

- [#26](https://github.com/nextlyhq/nextly/pull/26) [`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection mutation paths now resolve the physical table through `collection.tableName`, honoring `dbName` overrides instead of always deriving the name from the slug. The code-first boot sync detects when a collection's resolved `tableName` differs from the row in `dynamic_collections`, renames the physical table (Postgres/SQLite/MySQL quoted `ALTER TABLE ... RENAME TO`), writes the new name back, and invalidates the cached Drizzle schema in `CollectionFileManager` so the next request rebuilds against the renamed table — previously a `dbName` change left CRUD pointing at the stale table until a server restart. When both the old and new physical tables exist, the rename is skipped with a warn so the user can resolve the conflict manually. Component runtime-schema refresh after a UI-driven create/update/apply now flows through the DI `SchemaRegistry` (with a typed fallback to the adapter's `tableResolver` for non-DI paths) and surfaces failures as warnings instead of swallowing them in a silent try/catch — the prior behavior left `comp_*` queries selecting pre-rename column names until restart. Generated timestamp columns (`createdAt`, `updatedAt`) now emit `withTimezone: false` / plain `TIMESTAMP` for Postgres, aligning behavior across SQLite, MySQL, and Postgres.

- Updated dependencies [[`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.5
  - @nextlyhq/adapter-mysql@0.0.2-alpha.5
  - @nextlyhq/adapter-postgres@0.0.2-alpha.5
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.5

## 0.0.2-alpha.4

### Patch Changes

- [#23](https://github.com/nextlyhq/nextly/pull/23) [`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix Single document fields appearing empty after a component-field rename. Schema-apply and external-schema-update handlers invalidated `["collections"]`, `["entries"]`, `["singles"]`, and `["components"]` — but Single document data lives under a separate `["single-documents"]` namespace (used by `useSingleDocument`), which was never invalidated. After a rename, `useSingleSchema` refetched with the new field name while `useSingleDocument` kept serving cached data keyed by the old name, so the form rendered `data[newName]` as `undefined` and the field appeared blank until a hard refresh. Collections were unaffected because `useEntry` lives under `["entries"]`, which was already in the invalidation list. The `["single-documents"]` key is now invalidated alongside the others. Also propagate the Draft/Published `status` flag through `buildFullDesiredSchema` for both collections and singles, mirroring the earlier preview-pipeline fix so the full-schema build path doesn't drop the column either.

- Updated dependencies [[`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.4
  - @nextlyhq/adapter-mysql@0.0.2-alpha.4
  - @nextlyhq/adapter-postgres@0.0.2-alpha.4
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.4

## 0.0.2-alpha.3

### Patch Changes

- [#19](https://github.com/nextlyhq/nextly/pull/19) [`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc) Thanks [@aqib-rx](https://github.com/aqib-rx)! - HTTP read endpoints now return entries/documents regardless of status by default. Previously, `GET /api/collections/<slug>/entries`, `GET /api/collections/<slug>/entries/<id>`, `GET /api/collections/<slug>/entries/count`, and `GET /api/singles/<slug>` defaulted to "published-only" and required `?status=all` to see drafts — confusing for the admin API Playground, which returned 404 for any status-enabled single or collection whose only document was still in draft. The new default is to return all records; pass `?status=published` (or `?status=draft`) to filter explicitly. The routes still require authentication, so this only affects callers that already have read permission.

- Updated dependencies [[`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.3
  - @nextlyhq/adapter-mysql@0.0.2-alpha.3
  - @nextlyhq/adapter-postgres@0.0.2-alpha.3
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.3

## 0.0.2-alpha.2

### Patch Changes

- [#17](https://github.com/nextlyhq/nextly/pull/17) [`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix UI Schema Builder silently dropping the Draft/Published `status` column when editing a collection or single. Saving a field change on a `status: true` entity used to surface a "Rename status → \<new field\>" option (selected by default) because `previewDesiredSchema` did not propagate the Draft/Published flag into the desired snapshot — confirming the dialog DROPped the column and every subsequent entry POST with `status: "published"` failed with `table dc_<slug> has no column named status`. The flag now flows through the preview/apply pipeline for both collections and singles, so the column survives edits.

- Updated dependencies [[`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.2
  - @nextlyhq/adapter-mysql@0.0.2-alpha.2
  - @nextlyhq/adapter-postgres@0.0.2-alpha.2
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.2

## 0.0.2-alpha.1

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.

- Updated dependencies [[`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.1
  - @nextlyhq/adapter-mysql@0.0.2-alpha.1
  - @nextlyhq/adapter-postgres@0.0.2-alpha.1
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.1

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
  - @nextlyhq/adapter-postgres@0.0.2-alpha.0
  - @nextlyhq/adapter-mysql@0.0.2-alpha.0
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.0
