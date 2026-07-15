# Seed with Migrations Fix Plan

## 🔍 Issue Analysis

### Your Current Setup

- ✅ Removed Phase A (schema creation from TypeScript)
- ✅ Removed Phase B (permission sync)
- ✅ Removed schema-manifest.ts
- ✅ Created SQL migrations that define the schema
- ✅ Using **visual approach** (visual.config.ts)

### The Problem

When you click "Seed Demo Content" button, the flow is:

1. **Seed button clicked** → POST to `/admin/api/seed`
2. **Route calls** `getNextly({ config })` where config = visual.config.ts
3. **visual.config.ts has:**
   ```typescript
   collections: [],  // EMPTY!
   singles: [],       // EMPTY!
   ```
4. **Boot process runs:**
   - ✅ `applyPendingMigrations()` → Runs migrations → Creates tables (dc_posts, dc_categories, dc_tags)
   - ✅ `reloadNextlyConfig()` → Syncs collections from config → **NOTHING synced (empty array)**
5. **Collections registry stays EMPTY**
6. **Seed fails** with "Schema not found in registry"

### The Core Issue

**Migrations create physical tables, but Nextly's metadata system doesn't know about them.**

Nextly needs entries in the `dynamic_collections` table to:

- Know which collections exist
- Generate runtime schemas for queries
- Handle CRUD operations
- Make permissions work

**The Gap:**

```
Migrations → Physical tables (dc_posts, etc.) ✅
            ↓
            Missing: Collection metadata in dynamic_collections table ❌
            ↓
visual.config.ts → Empty collections array ❌
            ↓
Collections registry → EMPTY ❌
```

---

## 🎯 Two Possible Approaches

### Approach A: Add Collections to visual.config.ts (Quick Fix)

**Pros:**

- Simple, immediate fix
- Works with existing infrastructure
- Collections get synced automatically on boot

**Cons:**

- Visual approach is meant to have empty config (users create collections via UI)
- Less flexible for visual users

**Changes Needed:**

1. Update `visual.config.ts` to include blog collections (posts, categories, tags)
2. Same as codefirst.config.ts but for visual approach

---

### Approach B: Migration Metadata Bridge (Architecturally Correct)

**Pros:**

- Keeps visual.config.ts empty (by design)
- Collections registered from migration metadata
- More flexible for pure visual workflow
- Aligns with your migration-first approach

**Cons:**

- More complex implementation
- Requires new infrastructure to read migration metadata and register collections

**Changes Needed:**

1. Create a new service that reads migration snapshot files
2. After migrations run, parse the snapshot and register collections in `dynamic_collections`
3. Integrate this into the boot process after migrations are applied

---

## 📋 Detailed Plan (Approach B - Recommended)

### Step 1: Understand the Migration Metadata

Your migration has a snapshot file at:

```
templates/blog/migrations/meta/0001_000000_blog_schema.snapshot.json
```

This snapshot contains the collection definitions (posts, categories, tags, etc.).

### Step 2: Create Migration Metadata Reader Service

**New File:** `packages/nextly/src/domains/schema/migrate/metadata-register.ts`

**Purpose:**

- Read migration snapshot files
- Extract collection/singles definitions
- Register them in `dynamic_collections` table

**Functionality:**

```typescript
export async function registerCollectionsFromMigrations(opts: {
  migrationsDir: string;
  adapter: DatabaseAdapter;
  logger: Logger;
}): Promise<void>;
```

### Step 3: Integrate into Boot Process

**Modify:** `packages/nextly/src/init/boot-apply.ts`

**After migrations run:**

```typescript
// Step 1: Apply pending SQL migrations
await applyPendingMigrations(label);

// Step 1.5: Register collections from migration metadata (NEW)
const { registerCollectionsFromMigrations } = await import(
  "./domains/schema/migrate/metadata-register"
);
await registerCollectionsFromMigrations({
  migrationsDir: path.join(process.cwd(), "migrations"),
  adapter,
  logger: console,
});

// Step 2: Apply code-first schema changes
await reloadNextlyConfig();
```

### Step 4: Handle Visual Approach Edge Case

**Modify:** `packages/nextly/src/init/boot-apply.ts`

**Logic:**

- If config has collections → sync from config (code-first)
- If config is empty (visual approach) → check for migration metadata → register from migrations

### Step 5: Update Seed Route (Optional)

**Modify:** `templates/blog/src/app/admin/api/seed/route.ts`

**Add explicit migration run:**

```typescript
// Before seeding, ensure migrations are applied
const { ensureMigrationsApplied } = await import("nextly/migrations");
await ensureMigrationsApplied();
```

---

## 🔧 Implementation Details

### Migration Metadata Format

Your snapshot file already has the right format:

```json
{
  "collections": [
    {
      "slug": "posts",
      "tableName": "dc_posts",
      "labels": { "singular": "Post", "plural": "Posts" },
      "fields": [...]
    },
    ...
  ],
  "singles": [...]
}
```

### Registration Process

1. Read all `*.snapshot.json` files from `migrations/meta/`
2. Parse and merge collection definitions
3. For each collection:
   - Check if it exists in `dynamic_collections`
   - If not, insert the collection metadata
   - Register in the collections registry

---

## ✅ Expected Flow After Fix

### Visual Approach with Migrations:

1. **User clicks "Seed Demo Content"**
2. **Boot process:**
   - ✅ Migrations run → Create tables
   - ✅ **NEW:** Read migration snapshots → Register collections in metadata
   - ✅ Collections registry populated
3. **Seed runs:**
   - ✅ Creates categories, tags, posts
   - ✅ All operations succeed

### Key Insight:

**Migrations become the source of truth for schema in visual approach.**

- Code-first: Config → Collections → Tables
- Visual-first: Migrations (tables + snapshot) → Collections → Metadata

---

## 🎯 Summary

**The Issue:**

- Migrations create tables ✅
- But collection metadata stays empty ❌
- Visual config is empty (by design) ❌
- Collections registry stays empty ❌
- Seed fails ❌

**The Fix:**

- Read migration snapshot files
- Register collections from snapshot metadata
- Populate `dynamic_collections` table
- Collections registry becomes functional

**Which Approach Do You Prefer?**

- **Approach A:** Add collections to visual.config.ts (quick fix)
- **Approach B:** Create migration metadata bridge (architecturally correct)

Please review and let me know which direction you'd like me to implement!
