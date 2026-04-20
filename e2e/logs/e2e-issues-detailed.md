# E2E Testing - Detailed Issues & Findings Log

## Date: 2026-04-01

## Branch: feat/db-adapters

## Test Environment: SQLite, CLI-created project via yalc, macOS

---

## Issue #1: drizzle-kit must be in serverExternalPackages [CRITICAL - FIXED]

**Error:** `Module not found: Can't resolve '@electric-sql/pglite'`
**Where:** Next.js build/dev overlay
**Screenshot:** e2e-onboarding-build-error.png

**Root Cause:** When drizzle-kit was moved to regular dependencies (Phase 1), Next.js/Turbopack tries to bundle `drizzle-kit/api.js` which internally requires ALL database drivers including `@electric-sql/pglite`. These optional drivers aren't installed.

**Import trace:**

- `drizzle-kit/api.js` → requires `@electric-sql/pglite`, `@libsql/client`, etc.
- `@revnixhq/nextly/dist/chunk-*.mjs` (drizzle-kit-api.ts wrapper)
- `@revnixhq/nextly/dist/index.mjs`
- `src/app/admin/api/[[...params]]/route.ts`

**Investigation Steps:**

1. Navigated to `http://localhost:3000/admin` after creating project via CLI
2. Build Error overlay appeared with "Module not found: Can't resolve '@electric-sql/pglite'"
3. Checked existing `next.config.ts` - `serverExternalPackages` had drizzle-orm but NOT drizzle-kit
4. Added `"drizzle-kit"` to test project's next.config.ts - error resolved
5. Updated the CLI template and generator to include drizzle-kit

**Fix:** Added `"drizzle-kit"` to `serverExternalPackages` in both:

- `packages/create-nextly-app/templates/base/next.config.ts`
- `packages/create-nextly-app/src/generators/next-config.ts`

**Commit:** `bba46ada`

---

## Issue #2: Setup page shows after admin already created [WARNING - OPEN]

**Error:** 403 "account already created" but /admin/setup page still displays
**Where:** Admin setup page

**Root Cause:** CLI's `--seed` flag created an admin during project setup. The /admin/setup page doesn't check for existing users on mount - it always shows the form. When submitted, the API correctly rejects with 403.

**Investigation Steps:**

1. Created project with `--use-yalc` flag which ran migrations and seeding
2. Navigated to /admin - got redirected to /admin/setup
3. Filled form and submitted
4. API returned 403 "account already created"
5. Toast appeared briefly but page didn't redirect

**Suggested Fix:** Setup page should call setup-status API on mount and redirect to /login if admin exists.

**Status:** OPEN (low priority)

---

## Issue #3: SchemaRegistry maps by JS name not SQL name [CRITICAL - FIXED]

**Error:** `Table "dynamic_collections" not found in schema registry`
**Where:** `nextly dev --seed` on fresh database

**Root Cause:** `SchemaRegistry.registerStaticSchemas()` stored tables by their JavaScript export name (camelCase) but the adapter's CRUD methods query by SQL table name (snake_case).

**Detailed Analysis:**

```
Schema export: export const dynamicCollections = sqliteTable("dynamic_collections", {...})
JS key: "dynamicCollections" (camelCase)
SQL name: "dynamic_collections" (snake_case)
adapter.select("dynamic_collections", ...) → getTable("dynamic_collections") → NOT FOUND
```

Tables where JS name = SQL name worked fine (e.g., `users`, `accounts`). Tables with camelCase JS names failed (e.g., `dynamicCollections`, `contentSchemaEvents`, `passwordResetTokens`).

**Investigation Steps:**

1. Added SchemaRegistry initialization before sync (fix for Issue #3b)
2. Still got "Table not found" error for `dynamic_collections`
3. Printed registry keys - all camelCase: `["users", "accounts", "dynamicCollections", ...]`
4. Realized adapter queries use SQL names, not JS names
5. Used `getTableName()` from drizzle-orm to extract SQL names from table objects
6. Used `is()` from drizzle-orm to detect PgTable/MySqlTable/SqliteTable objects

**Fix:** Updated `registerStaticSchemas()` to use `getTableName()` for Drizzle table objects:

```typescript
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

registerStaticSchemas(schemas) {
  for (const [key, value] of Object.entries(schemas)) {
    if (this.isDrizzleTable(value)) {
      const sqlName = getTableName(value);
      this.staticSchemas[sqlName] = value;  // Use SQL name as key
    } else {
      this.staticSchemas[key] = value;  // Keep export name for non-tables
    }
  }
}
```

**Commit:** `46e06fc1`

---

## Issue #3b: SchemaRegistry not initialized before sync [CRITICAL - FIXED]

**Error:** `Table "dynamic_collections" not found in schema registry`
**Where:** `dev.ts` boot sequence

**Root Cause:** The SchemaRegistry was only set up inside `performAutoSync` (which runs AFTER `syncCollections`). But `syncCollections` queries `dynamic_collections` via the adapter's CRUD methods which require a TableResolver.

**Boot sequence order (before fix):**

```
1. createAdapter() → adapter created
2. ensureCoreTables() → creates physical tables
3. syncCollections() → queries dynamic_collections → FAILS (no resolver)
4. performAutoSync() → would have set SchemaRegistry → never reached
```

**Fix:** Added SchemaRegistry initialization immediately after adapter creation, before any sync:

```typescript
const earlyRegistry = new SchemaRegistry(dialect);
earlyRegistry.registerStaticSchemas(getDialectTables(dialect));
adapter.setTableResolver(earlyRegistry);
// NOW sync operations can query system tables
```

**Commit:** `bba46ada`

---

## Issue #4: Missing columns and tables in SQLite [CRITICAL - FIXED]

**Error:** `no such column: "access_rules"` then `no such table: site_settings`, `dynamic_singles`
**Where:** Various queries after table creation

**Root Cause:** SQLite tables were created by hand-written CREATE TABLE SQL statements that were incomplete:

- `SystemTableService.ensureSystemTables()` had `dynamic_collections` table missing `access_rules` and `hooks` columns
- `generateSqliteCoreTableStatements()` didn't include `site_settings`, `general_settings`, `dynamic_singles`, `api_keys`, and other tables
- Unlike PostgreSQL/MySQL which have proper SQL migration files, SQLite relied on manually-maintained SQL that drifted from the Drizzle schema

**Investigation Steps:**

1. Fixed Issue #3 - SchemaRegistry now finds tables
2. Got `no such column: "access_rules"` error
3. Compared raw SQL in SystemTableService with Drizzle schema in sqlite.ts
4. Found `access_rules` and `hooks` missing from SQL
5. Added them as quick fix
6. Then got `no such table: site_settings` - more missing tables
7. Realized hand-written SQL is fundamentally broken approach
8. Switched to `pushSchema()` for table creation (Issue #4b)

**Commit (partial fix):** `02c6a152`
**Proper fix:** Issue #4b

---

## Issue #4b: Use pushSchema() for table creation [CRITICAL - FIXED]

**Error:** Multiple missing tables when using hand-written SQL
**Where:** `ensureCoreTables` in dev.ts

**Root Cause:** The `ensureCoreTables` function used ~600 lines of hand-written CREATE TABLE SQL that was manually maintained and incomplete. This is the same approach we criticized and replaced in the adapter layer (Phases 0-2), but it was still being used for initial table creation.

**Proper Fix:** Replaced hand-written SQL with `DrizzlePushService.apply()` which calls `pushSchema()` from drizzle-kit/api. This guarantees physical tables match the Drizzle schema definitions 100%. Falls back to raw SQL + SystemTableService if pushSchema fails (TTY issue).

Also changed `ensureCoreTables` to run ALWAYS (not just with `--seed`) since system tables are needed for any operation.

**Commit:** `dc34e1e5`

---

## Issue #4c: SQLite migrations not bundled [CRITICAL - FIXED]

**Error:** No SQLite migration SQL files in published dist package
**Where:** `packages/nextly/scripts/postbuild.cjs`

**Root Cause:** The postbuild script only copied PostgreSQL and MySQL migrations to dist/. SQLite was missing.

**Fix:** Added SQLite section to postbuild.cjs:

```javascript
const sqliteSrc = join(rootDir, "src/database/migrations/sqlite");
const sqliteDest = join(rootDir, "dist/migrations/sqlite");
if (existsSync(sqliteSrc)) {
  cpSync(sqliteSrc, sqliteDest, { recursive: true });
}
```

**Commit:** `02c6a152`

---

## Issue #5: Dynamic collections not in API route SchemaRegistry [CRITICAL - FIXED]

**Error:** `Table "dc_product" not found in schema registry`
**Where:** POST /admin/api/collections/product/entries (create entry)

**Root Cause:** The SchemaRegistry in the DI container only had static system tables. Dynamic collection tables (dc_product, dc_posts) created via the visual schema builder weren't loaded because `register.ts` only called `getDialectTables()` (static schemas).

The boot sequence in `dev.ts` handles dynamic collections by iterating over `config.collections`. But the DI initialization has no access to the config - it needs to load collections from the database.

**Investigation Steps:**

1. Created "Products" collection via visual builder - success (201)
2. Tried to create an entry - got 500 "Table dc_product not found"
3. Verified dc_product table exists in DB via sqlite3
4. Checked register.ts - only `getDialectTables()` called (no dynamic tables)
5. Added code to query `dynamic_collections` via `executeQuery` (raw SQL)
6. Generated runtime schemas for each collection
7. Registered in SchemaRegistry

**Fix:** After registering static schemas in register.ts, query `dynamic_collections` via raw SQL and generate runtime Drizzle table objects:

```typescript
const collections = await adapter.executeQuery(
  "SELECT table_name, fields, slug FROM dynamic_collections"
);
for (const collection of collections) {
  const fields = JSON.parse(collection.fields);
  const { table } = generateRuntimeSchema(
    collection.table_name,
    fields,
    dialect
  );
  registry.registerDynamicSchema(collection.table_name, table);
}
```

Uses `executeQuery` (raw SQL) to avoid chicken-and-egg problem.

**Commit:** `9d4b2d22`

---

## Issue #5b: SchemaRegistry not in DI for API routes [CRITICAL - FIXED]

**Error:** `/admin/login` redirects to `/admin/setup` even with admin account
**Where:** DI container initialization

**Root Cause:** SchemaRegistry was only set in CLI (dev.ts). API routes create their own adapter via DI which had NO SchemaRegistry. All Drizzle CRUD queries from API routes failed, including the setup-status check.

**Fix:** Added SchemaRegistry initialization in `packages/nextly/src/di/register.ts` right after adapter registration.

**Commit:** `7d594397`

---

## Issue #6: Blog template pluralization [INFO - OPEN]

**Error:** "Postses" instead of "Posts"
**Where:** Blog template in create-nextly-app

**Root Cause:** Template has `singular: "Posts"` instead of `singular: "Post"`. Auto-pluralization adds "es" → "Postses".

**Status:** OPEN (cosmetic)

---

## Issue #7: Entry list query syntax error [CRITICAL - OPEN]

**Error:** `near "?": syntax error` in countEntries query
**Where:** GET /admin/api/collections/product/entries

**Root Cause:** Under investigation. Entry creation works (201), data exists in DB. But the list/count query fails.

**Extensive Investigation:**

1. **Direct Drizzle queries work:**

```javascript
drizzle(db)
  .select({ count: sql`count(*)` })
  .from(dcProduct)
  .all();
// Returns [{"count":1}] ← works!
```

2. **With RLS deny condition works:**

```javascript
drizzle(db)
  .select({ count: sql`count(*)` })
  .from(dcProduct)
  .where(sql`1 = 0`)
  .all();
// Returns [{"count":0}] ← works!
```

3. **getUserRoles query works:**

```javascript
d.select({ roleId: userRoles.roleId })
  .from(userRoles)
  .where(eq(userRoles.userId, id))
  .all();
// Returns [] ← works!
```

4. **inArray with empty array works:**

```javascript
d.select().from(userRoles).where(inArray(userRoles.roleId, [])).all();
// Returns [] ← works!
```

5. **await without .all() works:**

```javascript
await d.select({ count: sql`count(*)` }).from(dcProduct);
// Returns [{"count":1}] ← works!
```

**Suspected Causes:**

- Something in the RLS/access control query chain generates a `?` placeholder that isn't properly bound
- The `buildComponentFieldConditions` method builds raw SQL with `sql` template literals
- The `buildDrizzleCondition` or `buildSearchCondition` methods may have a dialect issue
- Default dialect fallback `this.adapter?.dialect || "postgresql"` could cause PG-style SQL on SQLite

**Next Steps:**

1. Enable Drizzle query logging (`{ logger: true }`) to see exact SQL
2. Add `query.toSQL()` logging before execution in countEntries
3. Test with `overrideAccess: true` to bypass all access control
4. Check `buildDrizzleCondition` and `buildSearchCondition` for PG-specific SQL

**Status:** OPEN - blocks entry listing in admin UI

---

## Issue #7b: Timestamp type mismatch [CRITICAL - FIXED]

**Error:** `value.getTime is not a function`
**Where:** Entry creation in collection-entry-service.ts line 2742

**Root Cause:** `new Date().toISOString()` produces a string. Drizzle's SQLite `integer("created_at", { mode: "timestamp" })` calls `.getTime()` on the value, which is a Date method, not a String method.

**Fix:** Changed `new Date().toISOString()` to `new Date()`. Drizzle handles Date→integer conversion internally per dialect.

**Commit:** `c75c136e`
