# Phase 4.10: backward-compat purge (design)

**Status:** approved 2026-05-03
**Branch:** `chore/phase-4-10-backward-compat-purge`
**Goal:** delete every `@deprecated` / "kept for backward compat" code path across the nextly framework that was identified in the original Phase 4 deferred-work audit. After this phase, the codebase has zero compat shims aimed at pre-Phase-4 users or pre-Alpha config shapes.

## Why

Per the user's standing directive in `29-phase-4-deferred-tasks-execution-prompt.md` §4: "we will not keep any legacy/backward compatibility code... no workarounds in any condition... best practices, no time constraints." The Phase 4 deferred-tasks audit identified ~50 marked compat sites; Phases 4.5/4.6/4.7/4.8 absorbed the natural Tier 1 fold-ins. Phase 4.10 (this design) handles the remaining Tier 2 work across four categories (B, C, D, E). Tier 3 (rewriting legacy services to throw NextlyError directly, killing the service-envelope translator) is explicitly out of scope and deferred to post-Alpha.

## Pre-Alpha context (drives every scope decision)

The user has confirmed twice during brainstorming that this codebase is pre-Alpha and has no production users we must preserve. Internal/test data can be regenerated. This rules out migration scripts and runtime fallbacks for every category below: failure modes are documented as loud breaking changes in the CHANGELOG, not silent data corruption.

## Scope per category

### Category B: field-type aliases (~6 files)

**What gets removed.** Legacy field-type aliases on `DynamicFieldType` in `packages/nextly/src/schemas/dynamic-collections.ts:46-76`:

| Canonical | Legacy alias dropped |
|---|---|
| `text` | `string` |
| `richText` | `richtext` |
| `number` | `decimal` |
| `checkbox` | `boolean` |
| `relationship` | `relation` |

Plus on `FieldDefinition` (lines 78-174):
- `defaultValue?: unknown` (legacy alias for `default`)
- `relatedCollection?: string` (legacy alias for `relationTo`)
- `relationType?: ...` (legacy alias for `options.relationType`)

**Runtime cleanup.** Every `field.type === "relation" || field.type === "relationship"` style check collapses to the canonical-only check. Sites:
- `domains/collections/services/collection-utils.ts:101-104` (`isRelationFieldType`)
- `domains/collections/services/collection-relationship-service.ts:46-49, 355-374, 561-600, 717, 1170` (~6 inline checks)
- `domains/collections/services/collection-mutation-service.ts` has 6 sites checking `f.type === "relation" && f.options?.relationType === "manyToMany"`. Switch to `f.type === "relationship" && (f.options?.relationType === "manyToMany" || f.hasMany)` per Lesson 3 in the deferred-tasks doc §7.
- `domains/dynamic-collections/services/dynamic-collection-schema-service.ts:1162-1163` (`case "richtext"` switch arm)
- `domains/collections/services/collection-utils.ts:15-16, 32` (`"richtext"` entry in field-type sets)

**Acceptance:** zero `"richtext"`, `"relation"` (as field type), `"string"` (as field type), `"decimal"`, `"boolean"` (as field type), `defaultValue`, `relatedCollection`, `relationType` (top-level on FieldDefinition) references in production code outside of one dropped legacy alias migration note in CHANGELOG.

### Category C: deprecated re-export shims (11 files deleted)

**Files deleted (after consumer imports are updated to canonical paths):**
1. `packages/nextly/src/services/dynamic-collections.ts`
2. `packages/nextly/src/services/dynamic-collections/dynamic-collection-schema-service.ts`
3. `packages/nextly/src/services/dynamic-collections/dynamic-collection-registry-service.ts`
4. `packages/nextly/src/services/dynamic-collections/dynamic-collection-validation-service.ts`
5. `packages/nextly/src/services/schema/schema-generator.ts`
6. `packages/nextly/src/services/schema/field-diff.ts`
7. `packages/nextly/src/services/schema/runtime-schema-generator.ts`
8. `packages/nextly/src/services/schema/schema-hash.ts`
9. `packages/nextly/src/services/schema/type-generator.ts`
10. `packages/nextly/src/services/schema/zod-generator.ts`
11. `packages/nextly/src/storage/adapters/base-adapter.ts` (re-export of `IStorageAdapter` types only). The `BaseStorageAdapter` abstract class either moves to its canonical location or stays in this file with the re-export removed. Plan-writing audit decides which.

Each is a thin `export * from "the-real-location"` shim with `@deprecated Moved to ...` JSDoc. None are listed in `packages/nextly/package.json` exports map, so external consumers cannot reach them through supported paths.

**Consumer audit method.** For each file, `grep -rn "from.*<path>"` across the monorepo (`packages/`, `apps/`, `templates/`). Update each consumer to import from the canonical location named in the file's existing `@deprecated` JSDoc. Then delete the re-export file.

**Acceptance:** all 11 files deleted; `pnpm tsc` clean across nextly + admin + plugin packages.

### Category D: architectural deprecations (~5 files)

**Sites removed:**

1. **`packages/nextly/src/di/register.ts`**: drop the legacy `db?` / `tables?` / `storage?` config fields on `defineConfig`. The DI container only accepts the `adapter:` field. Lines 116, 128, 134, 199 (interface fields) plus the runtime branch that creates an ad-hoc adapter when `db`/`tables` are passed instead.
2. **`packages/nextly/src/storage/types.ts:312-348`**: delete the `StorageConfig` legacy interface. Storage is configured via the storage-plugins array exclusively (`storage: [s3Storage(...)]`).
3. **`packages/nextly/src/plugins/plugin-context.ts:284-286`**: drop the `group?` field on plugin admin config. Plugins use `placement: AdminPlacement.X` exclusively.
4. **`packages/nextly/src/services/general-settings/general-settings-service.ts:209, 231`**: remove the deprecated method overloads / dead branches that handled the `group` field path.
5. **`packages/nextly/src/routeHandler.ts:986, 1097`**: drop the `group: plugin.admin?.group, // kept for backward compat` line and the dead "Plugin placement overrides are no longer supported" branch entirely.

**Acceptance:** zero `db?` / `tables?` / `storage?` (as legacy config field) / `group?` (on plugin admin) references in production code. CHANGELOG documents the rename mapping (`group` to `placement`, `{db, tables, storage}` to `adapter` + `storage: [...]`).

### Category E: Auth.js leftovers (~3 files)

**Sites removed:**

1. **`packages/nextly/src/auth/handlers/session.ts:44-67`**: drop the `LEGACY_COOKIE_NAMES` detection branch and the `SESSION_UPGRADED` 401 code. When no valid access token is present, emit the canonical `AUTH_REQUIRED` 401 directly. Existing logged-in Auth.js sessions on user machines force-logout cleanly (acceptable per pre-Alpha).
2. **`packages/nextly/src/auth/cookies/cookie-config.ts`**: delete the `LEGACY_COOKIE_NAMES` export entirely (no consumers after step 1).
3. **`packages/nextly/src/shared/lib/env.ts:35-70`**: drop the `AUTH_SECRET` / `NEXTAUTH_SECRET` env var fallback chain. Only `NEXTLY_SECRET` is read. Schema validation throws a clear startup error if `NEXTLY_SECRET` is missing in production. The `NEXTLY_SECRET_RESOLVED` indirection at line 140-141 collapses to direct `NEXTLY_SECRET` reads.
4. **`packages/nextly/src/actions/upload-media.ts:59`**: rewrite the JSDoc example to drop the `NextAuth: const session = await auth()` snippet. Replace with the canonical Nextly session pattern.

**Acceptance:** zero `next-auth` / `NEXTAUTH` / `LEGACY_COOKIE_NAMES` / `AUTH_SECRET` (as fallback) references in production code.

## Out of scope

- **Tier 3:** rewriting legacy services (`services/users.ts`, `services/collections-handler.ts`, `services/media.ts`) to throw `NextlyError` directly, which would let `dispatcher/helpers/service-envelope.ts:unwrapServiceResult` be deleted. Per the Phase 4 doc §6.5 this is a multi-week post-Alpha initiative.
- **The 18 surviving "backward compatibility" comment sites** that the audit flagged but where the underlying code is canonical and the comment is just describing why a particular API shape was chosen (e.g. `domains/collections/services/collection-metadata-service.ts:426`'s `// Also wrap in schemaDefinition for backwards compatibility`). The wrapping is intentional API design now, not a shim. Plan-writing will surface a final list and these stay as-is.

## Working conventions (from §4 of the Phase 4 doc)

Every commit must respect:
- No em dashes in code, comments, commit messages, PR descriptions. Use periods, semicolons, parens, or rephrase.
- No `as any`, `@ts-expect-error`, or `eslint-disable` for type rules
- No new test files (per user memory feedback); existing tests get updated where the rename breaks them
- NextlyError convention inside `packages/nextly/**` (no bare `Error` throws)
- Code comments explain WHY, not WHAT
- Canonical Drizzle ORM only, no raw SQL workarounds

## Commit structure

Four commits, one per category, all on `chore/phase-4-10-backward-compat-purge`:

1. `refactor(nextly): remove legacy field-type aliases (Phase 4.10 / Category B)`
2. `refactor(nextly): delete @deprecated re-export shims (Phase 4.10 / Category C)`
3. `refactor(nextly): drop legacy db/tables/storage/group config fields (Phase 4.10 / Category D)`
4. `refactor(nextly): drop Auth.js cookie + env var legacy fallbacks (Phase 4.10 / Category E)`

Single PR against `dev` after all four land. CHANGELOG updates folded into the relevant commit (or a separate doc commit at the end if it gets large).

## Acceptance gates (run after each commit)

- `pnpm --filter @revnixhq/nextly build` is clean
- `cd packages/nextly && pnpm exec tsc --noEmit` is clean
- `cd packages/nextly && pnpm vitest src/api src/dispatcher src/domains/media src/domains/collections --run` shows the 273+ baseline pass count holding
- `pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l` equals 43 (the established baseline)
- Em-dash check on the diff returns empty (the verification command is in the plan doc; the rule is "no em dashes were introduced")

## Self-review

- [x] Every category has explicit removed-files list + acceptance criteria.
- [x] No "TBD" / "implement later" placeholders. The one open question (`BaseStorageAdapter`'s final location at C-11) is flagged for plan-writing audit, not left vague.
- [x] Internal consistency: 4 categories to 4 commits to 1 PR. Conventions list applies to every commit.
- [x] Scope check: focused on a single goal (purge compat code per audit). No unrelated work bundled.
- [x] Ambiguity check: each item in the Sites lists cites a specific file path + line range, not a vague description.
- [x] Pre-Alpha rationale stated up front so future readers don't relitigate "should we add a migration?" per category.
- [x] Em-dash check on the doc itself returns empty.
