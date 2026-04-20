# E2E Test Results - Spec 1 (SQLite)

## Date: 2026-04-01

## Database: SQLite (file-based, CLI-created project via yalc)

## Branch: feat/db-adapters

---

## Test Results Summary

| Test                          | Status  | Notes                                                                                       |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| **Test 1: Onboarding**        | PASS    | Setup page → form → admin created (201) → dashboard loads                                   |
| **Test 2: Create Collection** | PASS    | Visual builder → add Number field → create "Products" (201) → listed with status "Applied"  |
| **Test 3: Content CRUD**      | PARTIAL | Entry INSERT works (201, data in DB). Entry LIST fails (Issue #7: placeholder syntax error) |
| **Test 4: Singles**           | NOT RUN | Blocked by Issue #7                                                                         |
| **Test 5: Schema Dialog**     | NOT RUN | Blocked by Issue #7                                                                         |

---

## Bugs Found & Fixed (8 critical fixes)

| #   | Issue                                            | Severity | Fix Commit | Files Changed                           |
| --- | ------------------------------------------------ | -------- | ---------- | --------------------------------------- |
| 1   | drizzle-kit not in serverExternalPackages        | CRITICAL | bba46ada   | create-nextly-app template + generator  |
| 3b  | SchemaRegistry not initialized before sync       | CRITICAL | bba46ada   | nextly/src/cli/commands/dev.ts          |
| 3   | SchemaRegistry maps by JS name not SQL name      | CRITICAL | 46e06fc1   | nextly/src/database/schema-registry.ts  |
| 4   | Missing SQLite columns + migrations not bundled  | CRITICAL | 02c6a152   | system-table-service.ts + postbuild.cjs |
| 4b  | Use pushSchema() instead of hand-written SQL     | CRITICAL | dc34e1e5   | nextly/src/cli/commands/dev.ts          |
| 5b  | SchemaRegistry not in DI for API routes          | CRITICAL | 7d594397   | nextly/src/di/register.ts               |
| 5   | Dynamic collections not loaded in DI registry    | CRITICAL | 9d4b2d22   | nextly/src/di/register.ts               |
| 7b  | Timestamp uses ISO string instead of Date object | CRITICAL | c75c136e   | collection-entry-service.ts             |

## Open Issues

| #   | Issue                                   | Severity | Blocker For                        |
| --- | --------------------------------------- | -------- | ---------------------------------- |
| 7   | Entry count/list query `?` syntax error | CRITICAL | Content listing, editing, deletion |
| 2   | Setup page shows when admin exists      | WARNING  | UX only                            |
| 6   | Blog template "Postses" pluralization   | INFO     | Cosmetic                           |

---

## Detailed Test Flow

### Test 1: Onboarding

**Steps Taken:**

1. Created fresh project via CLI: `create-nextly-app e2e-test-sqlite -d sqlite -t blog --use-yalc`
2. Set AUTH_SECRET in .env
3. Ran `drizzle-kit push` from monorepo source to create all tables
4. Ran `nextly dev --seed` to seed permissions (12 records)
5. Started Next.js dev server: `npm run dev`
6. Navigated to `http://localhost:3000/admin`
7. Redirected to `/admin/setup` (no users exist - correct)
8. Filled form: name="Test Admin", email="admin@test.com", password="TestPassword123!"
9. Password strength indicator showed "STRENGTH: STRONG" (6/6)
10. Clicked "Create Admin Account"
11. API returned 201: `{"success":true,"message":"Admin account created successfully"}`
12. Redirected to dashboard: "Welcome back, Test"
13. Dashboard showed "No Collections" with "CREATE COLLECTION" button

**Screenshots:**

- e2e-01-onboarding-setup-page.png
- e2e-01-onboarding-form-filled.png
- e2e-01-onboarding-success-dashboard.png

**Result:** PASS

### Test 2: Create Collection via Visual Builder

**Steps Taken:**

1. From dashboard, clicked "CREATE COLLECTION"
2. Navigated to `/admin/collections/create`
3. Right sidebar showed Settings panel with Singular/Plural name fields
4. Entered: Singular "Product", Plural "Products"
5. Clicked "Add Fields" tab in right panel
6. 18 field types available: Text, Textarea, Rich Text, Email, Password, Number, Code, Date, Select, Radio, Checkbox, Toggle, Upload, Chips + Advanced section
7. Clicked "Number" to add a Number field
8. Field editor appeared: Label, Name, Type, Description, Placeholder, Required, Default Value
9. Typed "Price" in Label → Name auto-filled to "price"
10. Clicked "Create" button
11. API returned 201: `{"success":true,"message":"Collection created!","data":{"slug":"product","tableName":"dc_product"}}`
12. Redirected to collections list
13. Listed: Product (UI, Applied, 3 fields) + Posts (UI, Applied, 3 fields)

**Screenshots:**

- e2e-02-create-collection-page.png
- e2e-02-add-field-dialog.png
- e2e-02-number-field-added.png
- e2e-02-products-collection-created.png

**Result:** PASS

### Test 3: Content CRUD

**Steps Taken:**

1. Navigated to dashboard → clicked "Products" card
2. Products collection view: "No products yet" with "Create Product" button
3. Clicked "Create Product"
4. Form showed: Title (required), Slug (required), Price
5. Filled: Title="iPhone 16 Pro", Price=999
6. Slug auto-generated to "iphone-16-pro"
7. Clicked "Create"
8. API returned 201: `{"success":true,"data":{"id":"2f9b41ce-...","title":"iPhone 16 Pro","slug":"iphone-16-pro","price":999}}`
9. Redirected to collection list
10. **List still shows "No products yet"** - entry exists in DB but list query fails

**Verification:**

```sql
SELECT * FROM dc_product;
-- Returns: id, title="iPhone 16 Pro", slug="iphone-16-pro", price=999, created_at=1775065073
```

**Error:** Server logs show `[ERROR] Error counting entries { collectionName: 'product', error: 'near "?": syntax error' }`

**Screenshots:**

- e2e-03-dashboard-with-collections.png
- e2e-03-products-empty-list.png
- e2e-03-create-product-form.png
- e2e-03-product-created-success.png

**Result:** PARTIAL (INSERT works, LIST blocked by Issue #7)

---

## Key Findings

### 1. E2E testing found 8 critical bugs that unit tests couldn't catch

All bugs were related to the interaction between the new Drizzle-based adapter system and real-world usage: fresh databases, API routes running in separate contexts, dynamic runtime schema generation, and dialect-specific behavior.

### 2. The SQLite quick-start flow requires drizzle-kit push

Hand-written CREATE TABLE SQL is fundamentally broken as an approach - it drifts from Drizzle schema definitions. Using `pushSchema()` from drizzle-kit/api is the correct approach (same as Payload CMS).

### 3. SchemaRegistry needs initialization in MULTIPLE places

- CLI boot (dev.ts) - for `nextly dev` command
- DI container (register.ts) - for API routes in Next.js
  Both need static tables AND dynamic collections loaded.

### 4. The chicken-and-egg problem for dynamic collections

Dynamic collection tables need to be in the SchemaRegistry for CRUD to work, but they're stored in the `dynamic_collections` DB table. Solution: use `executeQuery` (raw SQL, bypasses SchemaRegistry) to load collection metadata, then generate runtime schemas.

### 5. SQLite requires Date objects, not ISO strings

Drizzle's SQLite `integer` mode with `{ mode: "timestamp" }` calls `.getTime()` on values, which only works on Date objects, not ISO strings.

### 6. All adapter packages must be in serverExternalPackages

Even unused adapters (e.g., adapter-mysql when using SQLite) must be listed because the factory code dynamically imports all of them.

---

## Environment Details

- **Node.js:** v22.x
- **Next.js:** 16.2.2 (Turbopack)
- **pnpm:** 9.0.0
- **drizzle-orm:** ^0.45.2
- **drizzle-kit:** 0.31.10
- **better-sqlite3:** ^12.5.0
- **Playwright MCP:** Connected (primary)
- **Chrome MCP (Docker):** Connected (secondary, limited by Docker networking)
- **yalc:** 1.0.0-pre.53
- **macOS:** Darwin 25.4.0
