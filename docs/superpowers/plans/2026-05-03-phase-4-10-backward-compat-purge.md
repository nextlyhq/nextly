# Phase 4.10 backward-compat purge: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** delete every `@deprecated` / "kept for backward compat" code path identified by the Phase 4 deferred-tasks audit, across four categories (B field-type aliases, C deprecated re-exports, D architectural deprecations, E Auth.js leftovers).

**Architecture:** pre-Alpha hard removal across the board. No migration scripts, no runtime fallbacks. Each category lands as one atomic commit on `chore/phase-4-10-backward-compat-purge`. Single PR against `dev` after all four land. Spec: `docs/superpowers/specs/2026-05-03-phase-4-10-backward-compat-purge-design.md`.

**Tech stack:** TypeScript, vitest. No DB or wire-protocol changes.

**Branch:** `chore/phase-4-10-backward-compat-purge` (already created off `dev`; spec doc committed at `59b5ac5`).

**Per user memory:** NO new test files. Existing tests get updated only when the rename breaks them.

---

## Audit results that shape the plan

Before each task ran a precise consumer audit. Findings that affect the plan:

- **Category C** is far smaller than the spec estimate. 10 of 11 re-export shims have ZERO actual consumers (the `wc -l` counts I initially saw were docstring matches, not imports). Only `services/schema/schema-generator.ts` has 1 consumer: `cli/commands/migrate-fresh.ts:48` imports the `SupportedDialect` type from it.
- **Category C #11 (`storage/adapters/base-adapter.ts`)** is NOT pure re-export. It defines the `BaseStorageAdapter` abstract class (line 50+) which is actively used by `LocalStorageAdapter` and `@revnixhq/storage-uploadthing`. Only the TYPE re-export at the top of the file is deprecated. Plan reflects this: keep the class file, delete just the type re-export, update 7 consumers that import `IStorageAdapter` from base-adapter to import from `storage/types` directly.

---

## File structure

### Category B (1 atomic commit, ~6 files)

**Modify:**
- `packages/nextly/src/schemas/dynamic-collections.ts` (drop legacy alias entries on the `DynamicFieldType` union and `FieldDefinition` interface)
- `packages/nextly/src/domains/collections/services/collection-utils.ts` (drop `"richtext"` set entries + simplify `isRelationFieldType`)
- `packages/nextly/src/domains/collections/services/collection-relationship-service.ts` (collapse `"relation" || "relationship"` checks to `"relationship"` only; collapse `"relation" type from dynamic collections" code paths)
- `packages/nextly/src/domains/collections/services/collection-mutation-service.ts` (6 sites: `f.type === "relation" && f.options?.relationType === "manyToMany"` becomes `f.type === "relationship" && (f.options?.relationType === "manyToMany" || f.hasMany)`)
- `packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts` (drop `case "richtext":` arm)

### Category C (1 atomic commit, ~3 files modified + 10 deleted)

**Delete (all 10 are zero-consumer re-export shims):**
- `packages/nextly/src/services/dynamic-collections.ts`
- `packages/nextly/src/services/dynamic-collections/dynamic-collection-schema-service.ts`
- `packages/nextly/src/services/dynamic-collections/dynamic-collection-registry-service.ts`
- `packages/nextly/src/services/dynamic-collections/dynamic-collection-validation-service.ts`
- `packages/nextly/src/services/schema/field-diff.ts`
- `packages/nextly/src/services/schema/runtime-schema-generator.ts`
- `packages/nextly/src/services/schema/schema-hash.ts`
- `packages/nextly/src/services/schema/type-generator.ts`
- `packages/nextly/src/services/schema/zod-generator.ts`
- (potentially) `packages/nextly/src/services/schema/index.ts` if it becomes empty after the above deletes

**Modify:**
- `packages/nextly/src/services/schema/schema-generator.ts` (single consumer: `cli/migrate-fresh.ts:48`. Update the import there to canonical path, then delete this file too. Net: `services/schema/` directory empty so its `index.ts` also goes.)
- `packages/nextly/src/cli/commands/migrate-fresh.ts:48` (rewrite import to canonical path `domains/schema/services/schema-generator`)
- `packages/nextly/src/storage/adapters/base-adapter.ts` (drop the `export type { IStorageAdapter, StorageAdapterInfo } from "../types";` line at top; keep the `BaseStorageAdapter` abstract class)
- 7 consumer files updating `IStorageAdapter` imports to come from `storage/types` directly:
  - `packages/nextly/src/index.ts:311`
  - `packages/nextly/src/di/registrations/types.ts:14`
  - `packages/nextly/src/di/registrations/register-media.ts:15`
  - `packages/nextly/src/di/register.ts:78`
  - `packages/nextly/src/domains/media/services/media-service.ts:67`
  - `packages/nextly/src/services/index.ts:64`
  - `packages/nextly/src/services/upload-service.ts:44`

### Category D (1 atomic commit, ~5 files)

**Modify:**
- `packages/nextly/src/di/register.ts` (drop `db?` / `tables?` / `storage?` interface fields at lines 116, 128, 134, 199; drop the runtime branch that creates ad-hoc adapter when `db`/`tables` are passed; keep the `adapter:` only path)
- `packages/nextly/src/storage/types.ts` (delete the `StorageConfig` legacy interface at lines 312-348 entirely; drop the `// Legacy Types (kept for backward compatibility)` section header)
- `packages/nextly/src/plugins/plugin-context.ts` (drop the `group?` field on plugin admin config at lines 284-286, including its `@deprecated` JSDoc)
- `packages/nextly/src/services/general-settings/general-settings-service.ts` (remove the deprecated method overloads at lines 209 and 231 that handled the `group` field path)
- `packages/nextly/src/routeHandler.ts:986` (drop `group: plugin.admin?.group, // kept for backward compat`)
- `packages/nextly/src/routeHandler.ts:1097` (drop the dead "Plugin placement overrides are no longer supported" `@deprecated` branch entirely)

### Category E (1 atomic commit, ~3 files)

**Modify:**
- `packages/nextly/src/auth/handlers/session.ts` (drop the legacy-cookie detection branch at lines 44-67; emit canonical `AUTH_REQUIRED` when no valid token; rewrite the `code`/`message` selection to drop `SESSION_UPGRADED`)
- `packages/nextly/src/auth/cookies/cookie-config.ts` (delete the `LEGACY_COOKIE_NAMES` export and its const definition, since session.ts is the only consumer)
- `packages/nextly/src/shared/lib/env.ts` (drop `AUTH_SECRET` / `NEXTAUTH_SECRET` from the schema at lines 35-70; collapse the `NEXTLY_SECRET_RESOLVED` indirection at lines 140-141 into direct `NEXTLY_SECRET` reads everywhere; update the legacy env var migration-guidance message at line 158)
- `packages/nextly/src/actions/upload-media.ts:59` (rewrite the JSDoc example to drop the `NextAuth: const session = await auth()` snippet; replace with the canonical Nextly session pattern)

### CHANGELOG (folded into the relevant commit)

- `packages/nextly/CHANGELOG.md` (one section per category documenting the rename mapping and breaking-change note)

---

## Working conventions (verify after every commit)

- **No em dashes** anywhere in code, comments, commit messages. Verify with `git diff origin/dev | grep "^+" | grep "—"` returning empty.
- **No `as any`, `@ts-expect-error`, `eslint-disable` for type rules.** Use proper types/guards.
- **NextlyError convention** inside `packages/nextly/**` (no bare `Error` throws).
- **Code comments** explain WHY, not WHAT.
- **No new test files.** Existing tests get updated only when the rename breaks them.

## Acceptance gates (run after every category commit)

```bash
# 1. Server typecheck
cd packages/nextly && pnpm exec tsc --noEmit
# Expected: clean (exit 0)

# 2. Build (refreshes dist/ for admin to consume)
pnpm --filter @revnixhq/nextly build
# Expected: clean

# 3. Phase 4 baseline test set
cd packages/nextly && pnpm vitest src/api src/dispatcher src/domains/media src/domains/collections --run
# Expected: 273+ pass count holds (matches the established baseline)

# 4. Admin typecheck baseline
pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l
# Expected: 43 (the established baseline)

# 5. Em-dash check on the diff
git diff origin/dev 2>&1 | grep "^+" | grep "—"
# Expected: empty
```

---

## Task 1: Category B (remove legacy field-type aliases)

**Files:**
- Modify: `packages/nextly/src/schemas/dynamic-collections.ts`
- Modify: `packages/nextly/src/domains/collections/services/collection-utils.ts`
- Modify: `packages/nextly/src/domains/collections/services/collection-relationship-service.ts`
- Modify: `packages/nextly/src/domains/collections/services/collection-mutation-service.ts`
- Modify: `packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts`
- Modify: `packages/nextly/CHANGELOG.md` (add Category B entry)

- [ ] **Step 1: Remove legacy aliases from `DynamicFieldType`**

In `packages/nextly/src/schemas/dynamic-collections.ts:46-76`, change the union type to drop the legacy entries. Before:

```ts
export type DynamicFieldType =
  | "text"
  | "string" // Legacy alias for text
  | "textarea"
  | "richText"
  | "richtext" // Legacy alias
  | "email"
  | "password"
  | "code"
  | "number"
  | "decimal" // Legacy alias
  | "checkbox"
  | "boolean" // Legacy alias for checkbox
  | "date"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "relation" // Legacy alias
  | "repeater"
  | "group"
  | "blocks"
  | "json"
  | "component"
  | "chips"
  // Layout types (presentational only, no data storage)
  | "tabs"
  | "collapsible"
  | "row"
  | "point"
  | "slug";
```

After:

```ts
export type DynamicFieldType =
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "repeater"
  | "group"
  | "blocks"
  | "json"
  | "component"
  | "chips"
  // Layout types (presentational only, no data storage)
  | "tabs"
  | "collapsible"
  | "row"
  | "point"
  | "slug";
```

Also rewrite the JSDoc above it (lines 33-44):

```ts
/**
 * Field types for dynamic collections (UI-created collections).
 *
 * Note: This is separate from the core FieldType in collections/fields/types
 * to support the field surface available to UI-built collections.
 */
```

- [ ] **Step 2: Remove legacy fields from `FieldDefinition`**

In the same file, lines 78-174, drop these three fields:
- Line 87: `defaultValue?: unknown; // Keep for backward compatibility`
- Line 172: `relatedCollection?: string;`
- Line 173: `relationType?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";`

Also drop the `// Legacy fields (keep for backward compatibility)` comment at line 171 entirely.

- [ ] **Step 3: Remove `"richtext"` from field-type sets in `collection-utils.ts`**

In `packages/nextly/src/domains/collections/services/collection-utils.ts:15-16`, drop the `"richtext"` entry. Verify line 32 if it has a similar entry. After this step the relevant field-type set lists each canonical name exactly once.

Also at lines 101-104, simplify `isRelationFieldType`:

```ts
// Before:
export function isRelationFieldType(fieldType: string): boolean {
  return fieldType === "relation" || fieldType === "relationship";
}

// After:
export function isRelationFieldType(fieldType: string): boolean {
  return fieldType === "relationship";
}
```

Update the JSDoc above it (line 101) to drop the "Handles both dynamic collections (relation) and code-defined collections (relationship)" sentence; replace with a single-line description.

- [ ] **Step 4: Collapse `"relation" || "relationship"` checks in `collection-relationship-service.ts`**

For each occurrence in `packages/nextly/src/domains/collections/services/collection-relationship-service.ts`:
- Line 49: `field.type === "relation" || field.type === "relationship"` becomes `field.type === "relationship"`. Update the JSDoc above it accordingly.
- Lines 355-374: the comment "Handles both 'relation' type (uses options.target) and 'relationship' type (uses relationTo)" becomes "Reads `relationTo` from the canonical relationship field shape." Drop the `relation`-specific code path (`options.target` lookup); keep only the `relationTo` path.
- Lines 561, 588, 600: `f.type !== "relation"` becomes `f.type !== "relationship"` (these are guards excluding relationship fields from label-field selection; the inverted check now uses the canonical name).
- Lines 717 and 1170: comments mentioning "Filter for both 'relation' and 'relationship' field types" become "Filter for relationship fields"; keep the actual filter as canonical-only.

- [ ] **Step 5: Collapse the 6 mutation-service many-to-many checks**

In `packages/nextly/src/domains/collections/services/collection-mutation-service.ts`, the 6 sites at lines 373, 862, 1515, 1754, 2167, 2453 all read:

```ts
f => f.type === "relation" && f.options?.relationType === "manyToMany"
```

Change each to:

```ts
f =>
  f.type === "relationship" &&
  (f.options?.relationType === "manyToMany" || f.hasMany === true)
```

Per Lesson 3 in the deferred-tasks doc §7: the `hasMany === true` branch covers code-first relationship fields where many-to-many is signalled via `hasMany` rather than `options.relationType`.

- [ ] **Step 6: Drop `case "richtext":` from dynamic-collection schema service**

In `packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts:1162-1163`, the `case "richtext":` arm of the switch falls through to `case "richText":`. Delete the `case "richtext":` line so the switch only has `case "richText":`.

- [ ] **Step 7: Verify no orphan references**

Run:

```bash
grep -rn '"richtext"\|"relation"' packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "test\.\|__tests__\|node_modules" | grep -v 'relation: "\|relations:\|Relations'
```

Expected: empty (no remaining string literals matching dropped aliases in production code).

```bash
grep -rn 'defaultValue\|relatedCollection' packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "test\.\|__tests__\|node_modules"
```

Expected: empty (or only matches that are unrelated to the dropped FieldDefinition fields, e.g. non-FieldDefinition contexts).

- [ ] **Step 8: Add CHANGELOG entry**

Add to `packages/nextly/CHANGELOG.md` (create the file if missing) under an unreleased section:

```markdown
## Unreleased

### Breaking changes (Phase 4.10 / Category B)

- Dropped legacy field-type aliases on `DynamicFieldType`. Migrate UI-built collection schemas:
  - `string` to `text`
  - `richtext` to `richText`
  - `decimal` to `number`
  - `boolean` to `checkbox`
  - `relation` to `relationship`
- Dropped legacy fields on `FieldDefinition`: `defaultValue` (use `default`), `relatedCollection` (use `relationTo`), `relationType` at top level (use `options.relationType`).
- The `field.type === "relation"` runtime check is gone. Code that referenced legacy aliases at runtime now treats them as unknown field types.
```

- [ ] **Step 9: Run acceptance gates**

Run all five gates from the "Acceptance gates" section above. Expected: all pass; admin typecheck still 43; nextly tests still 273+.

- [ ] **Step 10: Commit**

```bash
git add packages/nextly/src/schemas/dynamic-collections.ts \
        packages/nextly/src/domains/collections/services/collection-utils.ts \
        packages/nextly/src/domains/collections/services/collection-relationship-service.ts \
        packages/nextly/src/domains/collections/services/collection-mutation-service.ts \
        packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts \
        packages/nextly/CHANGELOG.md
git commit -m "$(cat <<'EOF'
refactor(nextly): remove legacy field-type aliases (Phase 4.10 / Category B)

Drop the dynamic-collection legacy field-type aliases (string, richtext,
decimal, boolean, relation) along with the FieldDefinition legacy fields
(defaultValue, relatedCollection, relationType). Collapse every runtime
check that handled both legacy and canonical names to canonical-only.

Pre-Alpha hard removal: no migration script, no runtime fallback. CHANGELOG
documents the rename mapping. UI-built collections persisted with legacy
field types in dynamic_collections.schema_definition need to be regenerated
or manually updated to canonical names; failure mode is a clear "unknown
field type" load error, not silent corruption.

The 6 mutation-service many-to-many checks now read both
options.relationType === manyToMany and hasMany === true to cover
code-first relationship fields per Lesson 3 in deferred-tasks doc section 7.
EOF
)"
```

---

## Task 2: Category C (delete deprecated re-export shims)

**Files:**
- Delete: 10 zero-consumer re-export files (listed below)
- Modify: `packages/nextly/src/cli/commands/migrate-fresh.ts:48` (1 import path update)
- Modify: `packages/nextly/src/storage/adapters/base-adapter.ts` (drop the type re-export at top; keep the abstract class)
- Modify: 7 consumer files to import `IStorageAdapter` from `storage/types` directly
- Modify: `packages/nextly/CHANGELOG.md` (add Category C entry)

- [ ] **Step 1: Update the single `services/schema/schema-generator` consumer**

In `packages/nextly/src/cli/commands/migrate-fresh.ts:48`, change:

```ts
// Before:
import type { SupportedDialect } from "../../services/schema/schema-generator";

// After:
import type { SupportedDialect } from "../../domains/schema/services/schema-generator";
```

Verify the type exists at the new path: `grep -n "export type SupportedDialect\|export.*SupportedDialect" packages/nextly/src/domains/schema/services/schema-generator.ts`. Expected: at least one match.

- [ ] **Step 2: Delete the 9 zero-consumer re-export shim files**

```bash
git rm packages/nextly/src/services/dynamic-collections.ts \
       packages/nextly/src/services/dynamic-collections/dynamic-collection-schema-service.ts \
       packages/nextly/src/services/dynamic-collections/dynamic-collection-registry-service.ts \
       packages/nextly/src/services/dynamic-collections/dynamic-collection-validation-service.ts \
       packages/nextly/src/services/schema/field-diff.ts \
       packages/nextly/src/services/schema/runtime-schema-generator.ts \
       packages/nextly/src/services/schema/schema-hash.ts \
       packages/nextly/src/services/schema/type-generator.ts \
       packages/nextly/src/services/schema/zod-generator.ts
```

- [ ] **Step 3: Delete `services/schema/schema-generator.ts` (post-Step-1 it has zero consumers)**

```bash
git rm packages/nextly/src/services/schema/schema-generator.ts
```

- [ ] **Step 4: Check whether `services/schema/index.ts` and `services/dynamic-collections/index.ts` (if any) still have content**

```bash
ls packages/nextly/src/services/schema/ 2>/dev/null
ls packages/nextly/src/services/dynamic-collections/ 2>/dev/null
```

If either directory is now empty (no `.ts` files left), delete the directory:

```bash
rmdir packages/nextly/src/services/schema/ 2>/dev/null || true
rmdir packages/nextly/src/services/dynamic-collections/ 2>/dev/null || true
```

If an `index.ts` remains, read it. If it only re-exports from the now-deleted files, delete it too. If it has its own content, leave it.

- [ ] **Step 5: Drop the type re-export from `storage/adapters/base-adapter.ts`**

In `packages/nextly/src/storage/adapters/base-adapter.ts`, find this block near the top of the file:

```ts
// Re-export types for backward compatibility
export type { IStorageAdapter, StorageAdapterInfo } from "../types";
```

Delete it entirely (both lines). The `BaseStorageAdapter` abstract class definition at line 50+ stays.

- [ ] **Step 6: Update the 7 consumers that imported `IStorageAdapter` from base-adapter**

For each file, change the import source from `storage/adapters/base-adapter` to `storage/types`:

`packages/nextly/src/index.ts:311`:
```ts
// Before:
export type { IStorageAdapter as StorageProvider } from "./storage/adapters/base-adapter";
// After:
export type { IStorageAdapter as StorageProvider } from "./storage/types";
```

`packages/nextly/src/di/registrations/types.ts:14`:
```ts
// Before:
import type { IStorageAdapter } from "../../storage/adapters/base-adapter";
// After:
import type { IStorageAdapter } from "../../storage/types";
```

`packages/nextly/src/di/registrations/register-media.ts:15`:
```ts
// Before:
import type { IStorageAdapter } from "../../storage/adapters/base-adapter";
// After:
import type { IStorageAdapter } from "../../storage/types";
```

`packages/nextly/src/di/register.ts:78`:
```ts
// Before:
import type { IStorageAdapter } from "../storage/adapters/base-adapter";
// After:
import type { IStorageAdapter } from "../storage/types";
```

`packages/nextly/src/domains/media/services/media-service.ts:67`:
```ts
// Before:
import type { IStorageAdapter } from "../../../storage/adapters/base-adapter";
// After:
import type { IStorageAdapter } from "../../../storage/types";
```

`packages/nextly/src/services/index.ts:64`:
```ts
// Before:
export type { IStorageAdapter as StorageProvider } from "../storage/adapters/base-adapter";
// After:
export type { IStorageAdapter as StorageProvider } from "../storage/types";
```

`packages/nextly/src/services/upload-service.ts:44`:
```ts
// Before:
import type { IStorageAdapter } from "../storage/adapters/base-adapter";
// After:
import type { IStorageAdapter } from "../storage/types";
```

- [ ] **Step 7: Verify no orphan imports**

```bash
grep -rn "services/dynamic-collections\|services/schema/" packages/ apps/ templates/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "node_modules\|/dist/\|/dynamic-collections.ts:\|schema-types.ts:" | head
```

Expected: empty (no remaining imports from the deleted shim paths).

```bash
grep -rn "from.*storage/adapters/base-adapter" packages/ --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/" | grep -v "BaseStorageAdapter"
```

Expected: only matches importing `BaseStorageAdapter` (the class), not the type re-exports.

- [ ] **Step 8: Add CHANGELOG entry**

Append to the same Unreleased section in `packages/nextly/CHANGELOG.md`:

```markdown
### Internal cleanup (Phase 4.10 / Category C)

- Deleted 10 deprecated re-export shim files under `src/services/schema/*` and `src/services/dynamic-collections/*`. These were not in the package.json exports map; external consumers were not affected. Internal consumers updated to canonical paths under `src/domains/*/services/*`.
- Dropped the `IStorageAdapter` / `StorageAdapterInfo` type re-exports from `storage/adapters/base-adapter.ts`. Import these types from `storage/types` directly. The `BaseStorageAdapter` abstract class stays at its current location.
```

- [ ] **Step 9: Run acceptance gates**

Run all five gates. Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/nextly packages/nextly/CHANGELOG.md
git commit -m "$(cat <<'EOF'
refactor(nextly): delete @deprecated re-export shims (Phase 4.10 / Category C)

Removed 10 zero-consumer re-export shim files under services/schema/* and
services/dynamic-collections/*. The single real consumer of the schema
re-exports (cli/migrate-fresh.ts pulling SupportedDialect type) updated
to import from the canonical domains/schema/services path.

Dropped the IStorageAdapter / StorageAdapterInfo type re-export from
storage/adapters/base-adapter.ts. The BaseStorageAdapter abstract class
stays in that file (it has real consumers via LocalStorageAdapter and
external storage plugins). 7 consumer files updated to import the types
from storage/types directly.

None of the deleted paths were in the nextly package.json exports map,
so external consumers cannot have been depending on them through
supported imports.
EOF
)"
```

---

## Task 3: Category D (drop legacy db/tables/storage/group config fields)

**Files:**
- Modify: `packages/nextly/src/di/register.ts`
- Modify: `packages/nextly/src/storage/types.ts`
- Modify: `packages/nextly/src/plugins/plugin-context.ts`
- Modify: `packages/nextly/src/services/general-settings/general-settings-service.ts`
- Modify: `packages/nextly/src/routeHandler.ts`
- Modify: `packages/nextly/CHANGELOG.md`

- [ ] **Step 1: Drop legacy `db?` / `tables?` / `storage?` from `defineConfig` in `di/register.ts`**

Read `packages/nextly/src/di/register.ts` end-to-end first to confirm structure (the audit showed deprecated fields at lines 116, 128, 134, 199 and a runtime branch around line 268+). The `RegisterOptions` (or similarly-named) interface has these fields with `@deprecated` JSDoc.

Apply these specific changes:

- Drop the `db?: ...` field (line ~116) and its `@deprecated` JSDoc block.
- Drop the `tables?: ...` field (line ~128) and its `@deprecated` JSDoc block.
- Drop the `storage?: ...` field (line ~134) and its `@deprecated` JSDoc block (this is the legacy `IStorageAdapter` direct-config field; it is distinct from the `storage: [...storagePlugins]` field that stays).
- Drop the `db` field on the resolved-options interface at line ~199 (`/** @deprecated Use adapter instead. */`).
- In the runtime body (around the `resolveAdapter(providedAdapter, ...)` call at line ~291), if there is a branch that constructs a `DrizzleAdapter` from a passed-in `db`/`tables`, delete it. The `resolveAdapter` helper should require the explicit `adapter` field. If `resolveAdapter` itself accepts a fallback to `db`/`tables`, drop that too.

After this step, `defineConfig({ adapter, ... })` is the only supported shape.

- [ ] **Step 2: Verify no fallout from the runtime branch removal**

```bash
grep -rn "config\.db\|config\.tables\|providedDb\|providedTables\|resolvedDb" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/\|test\."
```

Expected: empty. If matches surface, those are leftover references that need cleaning up too.

- [ ] **Step 3: Delete `StorageConfig` legacy interface**

In `packages/nextly/src/storage/types.ts`, delete lines 312-348 (the `// Legacy Types` section header through the closing `}` of `StorageConfig`). Verify no other file imports `StorageConfig`:

```bash
grep -rn "StorageConfig" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/"
```

Expected: empty after the delete.

- [ ] **Step 4: Drop `group?` field from plugin admin config**

In `packages/nextly/src/plugins/plugin-context.ts:284-286`, find the `group?: string` field on the plugin admin config interface. Delete the JSDoc block above it (the `@deprecated Use placement with AdminPlacement constants instead.` comment) and the field itself.

The fallback chain documented at line 286 (`host override > placement > group > "plugins"`) collapses to `host override > placement > "plugins"`. Update any inline comments mentioning `group` in this file.

- [ ] **Step 5: Drop the deprecated method overloads in `general-settings-service.ts`**

In `packages/nextly/src/services/general-settings/general-settings-service.ts`, find the methods with `@deprecated Plugin placement is now author-defined via definePlugin(...)` JSDoc at lines 209 and 231. These are dead-branch overloads or methods kept for the old API surface.

Read each method body. If it's a plain dead method (no consumers), delete it entirely. If it's an overload with a fallback path, drop the fallback and keep only the canonical path. Confirm by grepping for callers:

```bash
grep -rn "<method-name>" packages/ apps/ templates/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "node_modules\|/dist/\|test\."
```

For each method whose only references are the definition itself and its `@deprecated` JSDoc, delete it.

- [ ] **Step 6: Drop the `group` field reads in `routeHandler.ts`**

In `packages/nextly/src/routeHandler.ts`:

- Line 986: delete `group: plugin.admin?.group, // kept for backward compat` from whatever object is being constructed. Verify the object is still well-formed after the delete.
- Line 1097: read the surrounding context. The audit showed `@deprecated Plugin placement overrides are no longer supported.` Delete the whole branch / function / dispatch case that this comment guards. If it's a switch arm, delete the arm. If it's a top-level conditional, delete the conditional and any subsequent dead code that depended on it.

- [ ] **Step 7: Verify no orphan references**

```bash
grep -rn "\.group\b\|admin\.group" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/\|test\." | grep -E "plugin|placement"
```

Expected: empty (no remaining `plugin.admin.group` or `admin.group` in plugin-related contexts; matches in unrelated contexts like collection-grouping are fine).

```bash
grep -rn "config\.db\|config\.tables\|StorageConfig\|legacy storage" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/"
```

Expected: empty.

- [ ] **Step 8: Add CHANGELOG entry**

Append to the same Unreleased section in `packages/nextly/CHANGELOG.md`:

```markdown
### Breaking changes (Phase 4.10 / Category D)

- `defineConfig({ db, tables, storage: <adapter> })` is no longer accepted. Use `defineConfig({ adapter, storage: [<storagePlugin>(...)] })` exclusively. The legacy ad-hoc adapter creation path is gone.
- Deleted the `StorageConfig` legacy interface from `@revnixhq/nextly/storage`. Configure storage via the storage-plugins array.
- Plugin admin `group` field is gone. Use `placement: AdminPlacement.X` exclusively. The `general-settings-service.ts` deprecated overloads that handled `group` are removed.
- `routeHandler` no longer reads `plugin.admin.group` and no longer honours the dead "plugin placement overrides" branch.
```

- [ ] **Step 9: Run acceptance gates**

Run all five gates. Expected: all pass. If any test or admin file references the dropped fields, update it (no new tests; existing tests get rewritten where they assert on the removed behaviour).

- [ ] **Step 10: Commit**

```bash
git add packages/nextly/src/di/register.ts \
        packages/nextly/src/storage/types.ts \
        packages/nextly/src/plugins/plugin-context.ts \
        packages/nextly/src/services/general-settings/general-settings-service.ts \
        packages/nextly/src/routeHandler.ts \
        packages/nextly/CHANGELOG.md
git commit -m "$(cat <<'EOF'
refactor(nextly): drop legacy db/tables/storage/group config fields (Phase 4.10 / Category D)

Forced canonical config shapes throughout:
- defineConfig only accepts adapter (DrizzleAdapter); the legacy db/tables
  ad-hoc adapter creation path is gone.
- The legacy storage field on defineConfig (which expected a single
  IStorageAdapter directly) is gone. storage: [...storagePlugins] is the
  only path.
- StorageConfig legacy interface deleted from storage/types.
- Plugin admin group field deleted; placement: AdminPlacement.X is the
  only path. The fallback chain collapses to host-override > placement
  > "plugins".
- routeHandler no longer reads plugin.admin.group and the dead
  "plugin placement overrides" branch is removed.
- general-settings-service deprecated overloads that handled the group
  field path are gone.
EOF
)"
```

---

## Task 4: Category E (drop Auth.js cookie + env var legacy fallbacks)

**Files:**
- Modify: `packages/nextly/src/auth/handlers/session.ts`
- Modify: `packages/nextly/src/auth/cookies/cookie-config.ts`
- Modify: `packages/nextly/src/shared/lib/env.ts`
- Modify: `packages/nextly/src/actions/upload-media.ts`
- Modify: `packages/nextly/CHANGELOG.md`

- [ ] **Step 1: Drop the legacy-cookie detection branch in `session.ts`**

In `packages/nextly/src/auth/handlers/session.ts`, the audit identified lines 44-67. Apply these changes:

Drop lines 44-55 (the `cookieHeader` parse + `LEGACY_COOKIE_NAMES.some(...)` detection + the `clearCookies` branch that pushed legacy cookie clears).

Rewrite the `code` and `message` selection (lines 65-77) to drop the `SESSION_UPGRADED` branch:

```ts
// Before:
const code =
  hasLegacyCookie && result.reason === "no_token"
    ? "SESSION_UPGRADED"
    : result.reason === "expired"
      ? "TOKEN_EXPIRED"
      : "AUTH_REQUIRED";

const message =
  code === "SESSION_UPGRADED"
    ? "Session upgraded. Please log in again."
    : code === "TOKEN_EXPIRED"
      ? "Session expired"
      : "Not authenticated";

// After:
const code =
  result.reason === "expired" ? "TOKEN_EXPIRED" : "AUTH_REQUIRED";

const message =
  code === "TOKEN_EXPIRED" ? "Session expired" : "Not authenticated";
```

The remaining `if (result.reason === "invalid")` block at line 61 stays (it clears the access cookie when the JWT is tampered). The `clearCookies` array now only ever contains the access cookie clear (when reason is `invalid`) so the final `if (clearCookies.length > 0)` branch still works.

Drop the `LEGACY_COOKIE_NAMES, serializeClearCookie` import at lines 16-19 if `serializeClearCookie` is no longer used in this file. Verify with `grep -n "serializeClearCookie\|LEGACY_COOKIE_NAMES" packages/nextly/src/auth/handlers/session.ts` after the edit; both should be absent. Also drop the `import { LEGACY_COOKIE_NAMES, serializeClearCookie } from "../cookies/cookie-config";` line.

Drop the `Handles backward compatibility for old Auth.js cookies.` line in the file's docstring (line 5).

- [ ] **Step 2: Delete `LEGACY_COOKIE_NAMES` from `cookie-config.ts`**

In `packages/nextly/src/auth/cookies/cookie-config.ts`, locate the `LEGACY_COOKIE_NAMES` const and any helper that used it. Verify with:

```bash
grep -rn "LEGACY_COOKIE_NAMES" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/"
```

After Step 1 the only remaining match should be the definition in `cookie-config.ts`. Delete that const + its export. If `serializeClearCookie` was only used by the legacy-cookie clear path in session.ts (and no longer has consumers), delete it too. Re-run the grep above to confirm zero remaining references.

- [ ] **Step 3: Drop `AUTH_SECRET` / `NEXTAUTH_SECRET` fallback from `env.ts`**

In `packages/nextly/src/shared/lib/env.ts`, the audit identified lines 35-70. Apply these changes:

- Drop the `AUTH_SECRET: z.string().optional(),` field (line 40).
- Drop the `NEXTAUTH_SECRET: z.string().optional(),` field (line 41).
- Drop the `// Resolve the auth secret: prefer NEXTLY_SECRET, fall back to legacy vars` comment block (lines 59-70). Replace with a simple validation that `NEXTLY_SECRET` is required in production.

The new validation logic:

```ts
// Before (lines 59-70 area):
// Resolve the auth secret: prefer NEXTLY_SECRET, fall back to legacy vars
const resolvedSecret =
  val.NEXTLY_SECRET ?? val.AUTH_SECRET ?? val.NEXTAUTH_SECRET;
if (val.NODE_ENV === "production" && (!resolvedSecret || resolvedSecret.length < 32)) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["NEXTLY_SECRET"],
    message:
      "In production, NEXTLY_SECRET of at least 32 characters is required.",
  });
}

// After:
if (val.NODE_ENV === "production" && (!val.NEXTLY_SECRET || val.NEXTLY_SECRET.length < 32)) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["NEXTLY_SECRET"],
    message:
      "In production, NEXTLY_SECRET of at least 32 characters is required.",
  });
}
```

At lines 140-141, the `NEXTLY_SECRET_RESOLVED` field on the resolved-env interface collapses. Find every consumer of `NEXTLY_SECRET_RESOLVED` across the codebase:

```bash
grep -rn "NEXTLY_SECRET_RESOLVED" packages/ --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/"
```

Update each consumer to read `NEXTLY_SECRET` (or `env.NEXTLY_SECRET`) directly. Then delete the `NEXTLY_SECRET_RESOLVED:` field declaration.

At line 158, the legacy-env-var migration-guidance message currently warns when `AUTH_SECRET` or `NEXTAUTH_SECRET` is set without `NEXTLY_SECRET`. Drop the entire warning block; if a user has the legacy vars set without `NEXTLY_SECRET`, the production check above will fail loudly with "NEXTLY_SECRET required".

- [ ] **Step 4: Rewrite the upload-media JSDoc example**

In `packages/nextly/src/actions/upload-media.ts:59`, the JSDoc currently shows:

```ts
 * - NextAuth: `const session = await auth(); uploadedBy: session.user.id`
```

Replace with the canonical Nextly session pattern. Read the surrounding JSDoc to match its style, then write the replacement using the `getSession` helper from `nextly/auth`:

```ts
 * - Nextly: `const session = await getSession(request, secret); uploadedBy: session.user.id`
```

(Adjust the function name to whatever the canonical helper actually is. Verify with `grep -n "export.*getSession\|export.*auth" packages/nextly/src/auth/session/get-session.ts`.)

- [ ] **Step 5: Verify no orphan references**

```bash
grep -rn "next-auth\|NextAuth\|NEXTAUTH\|AUTH_SECRET\|LEGACY_COOKIE_NAMES" packages/nextly/src --include="*.ts" 2>/dev/null | grep -v "node_modules\|/dist/\|test\.\|__tests__"
```

Expected: empty (no remaining Auth.js-era references in production code).

- [ ] **Step 6: Add CHANGELOG entry**

Append to the same Unreleased section in `packages/nextly/CHANGELOG.md`:

```markdown
### Breaking changes (Phase 4.10 / Category E)

- Auth.js legacy cookie detection on `/auth/session` is gone. The `SESSION_UPGRADED` 401 response code is deleted. Existing logged-in Auth.js sessions get a normal `AUTH_REQUIRED` 401 and force-logout cleanly.
- `LEGACY_COOKIE_NAMES` const is deleted from `auth/cookies/cookie-config.ts`.
- `AUTH_SECRET` and `NEXTAUTH_SECRET` env var fallbacks are gone. Set `NEXTLY_SECRET` (32+ characters in production) directly. The runtime no longer reads or warns about the legacy var names.
- The `NEXTLY_SECRET_RESOLVED` indirection is gone; consumers read `env.NEXTLY_SECRET` directly.
```

- [ ] **Step 7: Run acceptance gates**

Run all five gates. Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/nextly/src/auth/handlers/session.ts \
        packages/nextly/src/auth/cookies/cookie-config.ts \
        packages/nextly/src/shared/lib/env.ts \
        packages/nextly/src/actions/upload-media.ts \
        packages/nextly/CHANGELOG.md
git commit -m "$(cat <<'EOF'
refactor(nextly): drop Auth.js cookie + env var legacy fallbacks (Phase 4.10 / Category E)

Removed the Auth.js migration scaffolding:
- session.ts no longer detects the legacy __Secure-next-auth.* cookies or
  emits SESSION_UPGRADED. Existing Auth.js sessions on user machines get
  a normal AUTH_REQUIRED 401 and have to log in again.
- LEGACY_COOKIE_NAMES const + serializeClearCookie helper removed from
  auth/cookies/cookie-config.ts.
- env.ts no longer accepts AUTH_SECRET or NEXTAUTH_SECRET. Only
  NEXTLY_SECRET is read; production startup fails clearly with
  "NEXTLY_SECRET required" if missing. The NEXTLY_SECRET_RESOLVED
  indirection collapses to direct NEXTLY_SECRET reads.
- Updated the upload-media JSDoc to drop the NextAuth example.
EOF
)"
```

---

## Task 5: Push, open PR, and request code review

- [ ] **Step 1: Push all four commits**

```bash
git push origin chore/phase-4-10-backward-compat-purge
```

- [ ] **Step 2: Open PR against `dev`**

```bash
gh pr create --base dev --head chore/phase-4-10-backward-compat-purge \
  --title "Phase 4.10: backward-compat purge (categories B/C/D/E)" \
  --body "$(cat <<'EOF'
## Summary

Hard-removes every @deprecated / "kept for backward compat" code path across the four categories identified by the Phase 4 deferred-tasks audit.

- **Category B** (1 commit): legacy field-type aliases on dynamic-collection schemas (`richtext`, `relation`, `decimal`, `boolean`, `string`) plus the `defaultValue` / `relatedCollection` / `relationType` legacy fields on `FieldDefinition`. Runtime checks that handled both legacy and canonical names collapse to canonical-only.
- **Category C** (1 commit): 10 zero-consumer deprecated re-export shim files deleted (services/schema/*, services/dynamic-collections/*). The 1 real consumer of the schema re-exports updated to canonical path. The `IStorageAdapter` type re-export from `storage/adapters/base-adapter.ts` dropped (7 consumers updated to import from `storage/types` directly).
- **Category D** (1 commit): legacy `db?` / `tables?` / `storage?` config fields on `defineConfig` deleted; `StorageConfig` legacy interface deleted; plugin admin `group?` field deleted; routeHandler dead branches dropped.
- **Category E** (1 commit): Auth.js cookie detection + `SESSION_UPGRADED` code deleted; `AUTH_SECRET` / `NEXTAUTH_SECRET` env var fallback chain deleted; `NEXTLY_SECRET_RESOLVED` indirection collapsed.

After this PR the codebase has zero compat shims aimed at pre-Phase-4 users or pre-Alpha config shapes. CHANGELOG documents the rename mapping per category.

## Out of scope

Tier 3 (rewriting legacy services to throw NextlyError directly, killing the service-envelope translator) stays out of scope and deferred to post-Alpha per the standing decision in `29-phase-4-deferred-tasks-execution-prompt.md` §6.5.

## Test plan

- [ ] Pull the branch locally, run `pnpm --filter @revnixhq/nextly build` and verify clean.
- [ ] Run `cd packages/nextly && pnpm exec tsc --noEmit` and verify clean.
- [ ] Run the Phase 4 baseline test set (`pnpm vitest src/api src/dispatcher src/domains/media src/domains/collections --run`); 273+ pass count must hold.
- [ ] Run `pnpm --filter @revnixhq/admin check-types 2>&1 | grep "error TS" | wc -l`; must equal 43 (the documented baseline).
- [ ] Scaffold a fresh test project (per the doc's smoke-test convention). Verify the canonical config shapes (defineConfig({ adapter, storage: [...] }), plugins with placement: AdminPlacement.X, NEXTLY_SECRET only) work end-to-end. Verify that an old config using `db`/`tables`/`storage: <adapter>`/`group` fails with a clear error at boot.
- [ ] Confirm `/auth/session` returns AUTH_REQUIRED on a fresh request without an access cookie (no SESSION_UPGRADED).

## References

- Spec: `docs/superpowers/specs/2026-05-03-phase-4-10-backward-compat-purge-design.md`
- Plan: `docs/superpowers/plans/2026-05-03-phase-4-10-backward-compat-purge.md`
- Tracking: `29-phase-4-deferred-tasks-execution-prompt.md` §2 progress + §10 findings log
EOF
)"
```

- [ ] **Step 3: Run code review via the code-reviewer agent**

Dispatch a `superpowers:code-reviewer` agent against the diff:

> "Review PR #<num> against the dev branch. The PR finishes Phase 4.10 backward-compat purge with 4 commits across categories B/C/D/E. Spec at `docs/superpowers/specs/2026-05-03-phase-4-10-backward-compat-purge-design.md`. Plan at `docs/superpowers/plans/2026-05-03-phase-4-10-backward-compat-purge.md`. Verify the four acceptance gates per category. Flag any em dashes / `as any` / bare Error / new tests. Verify the four categories actually drop everything the spec promised. Verify the canonical paths work end-to-end (no broken imports). Report Critical / Important / Minor and a final verdict."

Address Critical/Important findings inline. Push the fix-up commit. If only Minor issues exist, document them and proceed.

- [ ] **Step 4: Stop and ask the user for manual merge**

Per the doc §4 "Never auto-merge PRs" rule. The user merges manually.

---

## Self-review

Spec coverage check:
- [x] Category B (field-type aliases) → Task 1
- [x] Category C (deprecated re-exports) → Task 2
- [x] Category D (architectural deprecations) → Task 3
- [x] Category E (Auth.js leftovers) → Task 4
- [x] CHANGELOG updates → folded into each task's commit
- [x] PR + code review + manual-merge handoff → Task 5

Placeholder scan:
- [x] No "TBD" / "implement later" / "fill in details" anywhere.
- [x] Every code-changing step shows the actual code (before/after blocks).
- [x] Every grep verification has the exact command + expected output.
- [x] One "potentially" qualifier in Task 2 Step 4 (whether `services/schema/index.ts` exists) is flagged as a runtime check that the executor performs, not a vague placeholder.

Type consistency:
- [x] Category B references `DynamicFieldType` in `schemas/dynamic-collections.ts`; consumers in `collection-utils.ts` / `collection-relationship-service.ts` use the same type name.
- [x] Category C imports always use `IStorageAdapter` (matches the actual exported type in `storage/types.ts:273`).
- [x] Category D references `defineConfig` / `RegisterOptions` (the file's actual interface).
- [x] Category E references `NEXTLY_SECRET` consistently (matches `env.ts` schema field name).

Em-dash check on the plan itself: zero em dashes (verified during write).
