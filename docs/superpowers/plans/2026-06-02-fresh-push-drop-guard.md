# Fresh-Push Drop-Guard Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `nextly migrate` Phase 1 (and every other `freshPushSchema` caller) from silently dropping user content tables, by sharing the exact drop-guard that already protects the dev server.

**Architecture:** Extract `filterUnsafeStatements` (+ its helpers) from `PushSchemaPipeline` into a shared pure module, then wire it into `freshPushSchema`'s SQLite/PG/MySQL paths. The guard blocks `DROP TABLE`/`DROP SEQUENCE`/`DROP INDEX` for any object whose owner table is not in the *desired* set — where the desired set is derived as the **SQL table names** of the Drizzle tables handed in (not their JS export keys). `migrate:fresh` is untouched (its wipe is a separate explicit `dropAllTables`).

**Tech Stack:** TypeScript, drizzle-orm + drizzle-kit, Vitest, better-sqlite3 (in-memory) for the integration test.

**Spec:** `docs/superpowers/specs/2026-06-02-fresh-push-drop-guard-design.md`

**Branch:** `feat/schema-pipeline/fix-fresh-push-drop-guard` (already created).

---

## Pre-flight context (read once)

- **`pnpm` is not on PATH.** Use `corepack pnpm`.
- Run a single test file: `corepack pnpm --filter nextly exec vitest run <path>`
- Lint a package: `corepack pnpm --filter nextly lint` (zero-warnings; `import-x/order` is auto-fixable via `lint:fix`).
- **Commits:** `--no-verify` is acceptable for doc/test-only commits; for the final green state run the real hook. Identity is already `aqib-rx` / `aqib.revnix@gmail.com`. **Do NOT add Claude/AI co-author trailers** (user instruction).
- Source of truth for the guard today: `packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts`
  - `filterUnsafeStatements` — lines 955-1066
  - `inferOwnerTableFromObjectName` — lines 1089-1101
  - `ORPHAN_DROP_PATTERNS` — lines 222-234
  - `isDrizzleTable` — lines 1193-1199
  - `getDrizzleTableName` — lines 1201-1207
  - call sites: `this.filterUnsafeStatements(...)` line 843; `this.inferOwnerTableFromObjectName(...)` line 1048; `this.isDrizzleTable`/`this.getDrizzleTableName` lines 1138-1139.

## File Structure

- **Create** `packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts`
  Exports: `filterUnsafeStatements(statements, desiredTableNames)`, `isDrizzleTable(value)`, `getDrizzleTableName(value, fallback)`, `drizzleTableNames(schema)`. Module-private: `inferOwnerTableFromObjectName`, `ORPHAN_DROP_PATTERNS`. Imports `isManagedTable` from `./managed-tables`.
- **Create** `packages/nextly/src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts`
- **Modify** `packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts` — delete the moved code; import + delegate.
- **Modify** `packages/nextly/src/domains/schema/pipeline/fresh-push.ts` — derive `desiredTableNames`; apply the guard in all three paths; PG switches from `result.apply()` to filter→execute→transaction.
- **Modify** `packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.test.ts` — update PG tests (no longer call `apply()`), add guard tests.
- **Create** `packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.drop-guard.integration.test.ts` — real SQLite proof.

---

## Task 1: Extract the guard + helpers into a shared module

**Files:**
- Create: `packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts`
- Create: `packages/nextly/src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts`
- Modify: `packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts`

- [ ] **Step 1: Write the failing test for the new module**

Create `packages/nextly/src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

import { getDialectTables } from "../../../../database/index";

import {
  drizzleTableNames,
  filterUnsafeStatements,
} from "../filter-unsafe-statements";

afterEach(() => vi.restoreAllMocks());

describe("drizzleTableNames", () => {
  it("returns SQL table names (not JS export keys) and skips non-tables", () => {
    const names = drizzleTableNames(getDialectTables("sqlite"));
    // SQL names, derived from Symbol.for('drizzle:Name'):
    expect(names).toContain("dynamic_collections");
    expect(names).toContain("email_templates");
    expect(names).toContain("users");
    // Export keys (camelCase) must NOT appear:
    expect(names).not.toContain("dynamicCollections");
    expect(names).not.toContain("emailTemplates");
    // Relations exports are not tables and must be excluded:
    expect(names).not.toContain("dynamicCollectionsRelations");
  });
});

describe("filterUnsafeStatements", () => {
  it("blocks DROP TABLE for a table NOT in the desired set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ["DROP TABLE `dc_articles`", 'CREATE TABLE "users" ("id" text)'],
      ["users"]
    );
    expect(out).toEqual(['CREATE TABLE "users" ("id" text)']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });

  it("ALLOWS DROP TABLE for a table IN the desired set (rebuild pattern)", () => {
    const out = filterUnsafeStatements(
      ["DROP TABLE `dynamic_collections`"],
      ["dynamic_collections"]
    );
    expect(out).toEqual(["DROP TABLE `dynamic_collections`"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts`
Expected: FAIL — `Cannot find module '../filter-unsafe-statements'`.

- [ ] **Step 3: Create the shared module**

Create `packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts`. Move the bodies **verbatim** from `pushschema-pipeline.ts` (convert the `this.`-methods to module functions), and add `drizzleTableNames`:

```ts
// Shared drop-guard for drizzle-kit pushSchema output.
//
// drizzle-kit's pushSchema can emit DROP TABLE / DROP SEQUENCE / DROP INDEX
// for any object that exists in the live DB but is absent from the desired
// schema it was handed. Both PushSchemaPipeline (dev server / HMR) and
// freshPushSchema (nextly migrate Phase 1, ensureCoreTables) run pushSchema
// against a desired schema that is narrower than the live DB, so both MUST
// strip drops of objects the caller never asked about — otherwise user
// content tables (dc_/single_/comp_) get destroyed as collateral.
//
// The desired set is compared by SQL table name. Callers that hold a Drizzle
// schema bundle MUST derive names via `drizzleTableNames` (Symbol-based),
// NOT Object.keys() — bundle keys are JS export names (dynamicCollections),
// not SQL names (dynamic_collections), and include non-table exports.

import { isManagedTable } from "./managed-tables";

const ORPHAN_DROP_PATTERNS: ReadonlyArray<{
  kind: "SEQUENCE" | "INDEX";
  re: RegExp;
}> = [
  {
    kind: "SEQUENCE",
    re: /^DROP\s+SEQUENCE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
  {
    kind: "INDEX",
    re: /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
];

/** Cheap structural check for Drizzle tables (carry Symbol.for("drizzle:Name")). */
export function isDrizzleTable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Symbol.for("drizzle:Name") in value;
}

/** Extract a Drizzle table's SQL name, falling back to the export key. */
export function getDrizzleTableName(value: unknown, fallback: string): string {
  const named = (value as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
  return typeof named === "string" ? named : fallback;
}

/**
 * SQL table names of every Drizzle table in a schema bundle. Skips non-table
 * exports (relations). This is the correct allow-list for filterUnsafeStatements
 * — NEVER use Object.keys(schema), which yields JS export keys.
 */
export function drizzleTableNames(schema: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const [exportKey, value] of Object.entries(schema)) {
    if (isDrizzleTable(value)) names.push(getDrizzleTableName(value, exportKey));
  }
  return names;
}

/**
 * Infer the owner table of a sequence/index from PG default naming
 * (`<table>_<col>_seq`, `<table>_<cols>_{idx|key|pkey|unique}`). Walk
 * underscore-prefixes longest-first; return the first found in desiredSet,
 * else null (can't identify → treat as unsafe).
 */
function inferOwnerTableFromObjectName(
  objectName: string,
  desiredSet: ReadonlySet<string>
): string | null {
  const lower = objectName.toLowerCase();
  const parts = lower.split("_");
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join("_");
    if (desiredSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Strip data-losing drops drizzle-kit emits for objects outside the desired
 * schema. Rule: DROP of a table IN the desired set is ALLOWED (intentional
 * rebuild — CREATE __new / DROP / RENAME); DROP of a table NOT in the desired
 * set is BLOCKED + warned. Same policy for DROP SEQUENCE / DROP INDEX via
 * inferred owner table.
 */
export function filterUnsafeStatements(
  statements: string[],
  desiredTableNames: string[]
): string[] {
  const desiredSet = new Set(desiredTableNames.map(t => t.toLowerCase()));

  return statements.filter(stmt => {
    const dropMatch = stmt.match(
      /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i
    );
    if (dropMatch) {
      const tableName = dropMatch[1] ?? "<unknown>";
      if (desiredSet.has(tableName.toLowerCase())) return true;
      console.warn(
        `[Nextly schema] Blocked DROP TABLE "${tableName}" emitted by ` +
          `drizzle-kit pushSchema (table not in current desired schema). ` +
          `If this drop was intentional, route it through the ` +
          `pre-resolution executor with explicit user confirmation. ` +
          `(managed=${isManagedTable(tableName)})`
      );
      return false;
    }

    for (const { kind, re } of ORPHAN_DROP_PATTERNS) {
      const m = stmt.match(re);
      if (!m) continue;
      const objectName = m[1] ?? "";
      if (inferOwnerTableFromObjectName(objectName, desiredSet) !== null) {
        return true;
      }
      console.warn(
        `[Nextly schema] Blocked DROP ${kind} "${objectName}" emitted by ` +
          `drizzle-kit pushSchema (owner table not in current desired ` +
          `schema or name is non-conventional). If this drop was ` +
          `intentional, route it through the pre-resolution executor ` +
          `with explicit user confirmation, or drop it manually before ` +
          `re-running if the ${kind.toLowerCase()} name is custom.`
      );
      return false;
    }

    return true;
  });
}
```

> NOTE: copy the full block comments from the original `filterUnsafeStatements` (lines 959-1008) into this function's docstring if practical — they explain the SQLite rebuild rationale. Keeping them is preferred; the abbreviated docstring above is the minimum.

- [ ] **Step 4: Run the new module test to verify it passes**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `pushschema-pipeline.ts` to delegate**

In `pushschema-pipeline.ts`:
1. Replace the `isManagedTable` import (line 50) with:
   ```ts
   import { MANAGED_TABLE_PREFIXES_REGEX, isManagedTable } from "./managed-tables";
   import {
     drizzleTableNames,
     filterUnsafeStatements,
     getDrizzleTableName,
     isDrizzleTable,
   } from "./filter-unsafe-statements";
   ```
   (Keep the `managed-tables` import — line 1305 re-exports `MANAGED_TABLE_PREFIXES_REGEX` + `isManagedTable`.)
2. Delete `ORPHAN_DROP_PATTERNS` (lines 222-234).
3. Delete the private methods `filterUnsafeStatements` (955-1066), `inferOwnerTableFromObjectName` (1089-1101), `isDrizzleTable` (1193-1199), `getDrizzleTableName` (1201-1207).
4. Update call sites to the imported functions:
   - Line 843: `const safe = filterUnsafeStatements(emittedStatements, desiredTableNames);`
   - Lines 1138-1139 (inside `buildDrizzleSchema`):
     ```ts
     if (isDrizzleTable(value)) {
       const sqlName = getDrizzleTableName(value, exportKey);
       out[sqlName] = value;
     }
     ```

- [ ] **Step 6: Verify the pipeline + dev-server tests still pass**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/pushschema-pipeline.test.ts src/init/__tests__`
Expected: PASS (no behavior change — the dev server path is byte-identical). The `filterUnsafeStatements orphan-DDL guards (Task 6.1)` describe block (pipeline test ~line 1714) must stay green.

Also typecheck: `corepack pnpm --filter nextly exec tsc --noEmit` → no errors about unused/missing symbols.

- [ ] **Step 7: Commit**

```bash
git add packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts \
        packages/nextly/src/domains/schema/pipeline/__tests__/filter-unsafe-statements.test.ts \
        packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts
git commit -m "refactor(schema): extract filterUnsafeStatements to shared module"
```

---

## Task 2: Wire the guard into `freshPushSchema`

**Files:**
- Modify: `packages/nextly/src/domains/schema/pipeline/fresh-push.ts`
- Modify: `packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.test.ts`

Behavior change: the PG path no longer calls `result.apply()`. It reads `result.statementsToExecute`, filters them, and executes the safe set inside a transaction. SQLite filters per-statement before its execution loop. MySQL applies the (no-op) filter for uniformity.

- [ ] **Step 1: Update + add failing tests in `fresh-push.test.ts`**

The existing PG suite (lines 79-119) asserts `apply()` is called and `fakeDb = {}`. Replace that suite with the transaction-based shape, and add guard tests. Replace the `describe("PostgreSQL", ...)` block with:

```ts
  describe("PostgreSQL", () => {
    // Minimal fake PG drizzle db: db.transaction(cb) runs cb with a tx that
    // records executed raw SQL. fresh-push imports drizzle-orm's sql.raw, so
    // tx.execute receives an SQL object — we stringify via its queryChunks is
    // overkill; just count calls and capture the statements we pass in.
    function makePgDb() {
      const executed: string[] = [];
      const tx = {
        execute: vi.fn().mockImplementation(() => Promise.resolve()),
      };
      const db = {
        transaction: vi
          .fn()
          .mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => {
            await cb(tx);
          }),
      };
      return { db, tx, executed };
    }

    it("filters out DROP TABLE for tables not in the schema, executes the rest", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: [
          "DROP TABLE \"dc_articles\"",
          "ALTER TABLE \"users\" ADD COLUMN \"email\" text",
        ],
        apply: vi.fn(),
      };
      const { db, tx } = makePgDb();
      // schema with one real drizzle table named "users" is enough for the
      // allow-list; dc_articles is absent → its DROP must be blocked.
      const result = await freshPushSchema("postgresql", db, fakeUsersSchema());

      expect(db.transaction).toHaveBeenCalledOnce();
      // Only the safe ALTER reaches the executor:
      expect(tx.execute).toHaveBeenCalledTimes(1);
      expect(result.statementsExecuted).toEqual([
        "ALTER TABLE \"users\" ADD COLUMN \"email\" text",
      ]);
      expect(mockPushSchemaResult.apply).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Blocked DROP TABLE "dc_articles"')
      );
    });

    it("propagates errors from statement execution", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ["CREATE TABLE \"users\" (\"id\" text)"],
        apply: vi.fn(),
      };
      const db = {
        transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
          await cb({
            execute: vi.fn().mockRejectedValue(new Error("connection refused")),
          });
        }),
      };
      await expect(
        freshPushSchema("postgresql", db, fakeUsersSchema())
      ).rejects.toThrow("connection refused");
    });
  });
```

Add this helper near the top of the test file (after the imports), which builds a one-table Drizzle schema so `drizzleTableNames` yields `["users"]`:

```ts
import { pgTable, text } from "drizzle-orm/pg-core";
function fakeUsersSchema() {
  return { users: pgTable("users", { id: text("id").primaryKey() }) };
}
```

Add a SQLite guard test inside `describe("SQLite", ...)`:

```ts
    it("filters out DROP TABLE for tables not in the schema", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ["DROP TABLE `dc_articles`"],
        apply: vi.fn(),
      };
      const fakeDb = { run: vi.fn(), all: vi.fn().mockReturnValue([]) };
      const { sqliteTable, text: sqlText } = await import("drizzle-orm/sqlite-core");
      const schema = { users: sqliteTable("users", { id: sqlText("id").primaryKey() }) };

      const result = await freshPushSchema("sqlite", fakeDb, schema);

      expect(fakeDb.run).not.toHaveBeenCalled();
      expect(result.statementsExecuted).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Blocked DROP TABLE "dc_articles"')
      );
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/fresh-push.test.ts`
Expected: FAIL — PG still calls `apply()` / no `transaction`; SQLite still executes the DROP.

- [ ] **Step 3: Implement the guard in `fresh-push.ts`**

Add the import at the top of `fresh-push.ts`:
```ts
import {
  drizzleTableNames,
  filterUnsafeStatements,
} from "./filter-unsafe-statements";
```

**PG path** — replace the PostgreSQL branch (current lines 88-97) with:
```ts
  // PostgreSQL: pushSchema computes the diff, but we execute the statements
  // ourselves so the shared drop-guard can strip drops of tables outside the
  // provided schema (drizzle-kit's own apply() would run them opaquely). The
  // safe set runs inside one transaction for atomic reconcile.
  const kit = await getPgDrizzleKit();
  const result = await kit.pushSchema(schema, db, ["public"]);
  const desiredTableNames = drizzleTableNames(schema);
  const safe = filterUnsafeStatements(result.statementsToExecute, desiredTableNames);
  const { sql: sqlTag } = await import("drizzle-orm");
  const executed: string[] = [];
  type PgTxDb = {
    transaction: (
      fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>
    ) => Promise<void>;
  };
  await (db as PgTxDb).transaction(async tx => {
    for (const raw of safe) {
      const stmt = raw.replace(/--> statement-breakpoint/g, "").trim();
      if (!stmt) continue;
      await tx.execute(sqlTag.raw(stmt));
      executed.push(raw);
    }
  });
  return {
    hasDataLoss: result.hasDataLoss,
    warnings: result.warnings,
    statementsExecuted: executed,
    applied: true,
  };
```

**SQLite path** — in `applyViaPushSchemaSQLite`, after building `pieces` for each entry (current line 139, after the `.filter(...)` chain that ends the `pieces` assignment), filter them. Change the loop body so the `pieces` array is guarded:
```ts
    const safePieces = filterUnsafeStatements(pieces, desiredTableNames);
    for (const raw of safePieces) {
```
and add, near the top of `applyViaPushSchemaSQLite` (right after `const kit = await getSQLiteDrizzleKit();` / before the `pushSchema` call is fine), the desired set:
```ts
  const desiredTableNames = drizzleTableNames(schema);
```
(`applyViaPushSchemaSQLite` already receives `schema` as a param — confirm and use it.)

**MySQL path** — in `applyViaGenerate`, after computing `individualStatements` (current line ~266), filter them:
```ts
    const safeStatements = filterUnsafeStatements(
      individualStatements,
      drizzleTableNames(schema)
    );
    for (let stmt of safeStatements) {
```
(Rename the loop variable usage accordingly. This is a no-op in practice — the empty-snapshot diff emits only CREATE — but keeps all paths uniform.)

- [ ] **Step 4: Run to verify the tests pass**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/fresh-push.test.ts`
Expected: PASS (all PG/SQLite/MySQL suites green, including the new guard tests).

- [ ] **Step 5: Commit**

```bash
git add packages/nextly/src/domains/schema/pipeline/fresh-push.ts \
        packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.test.ts
git commit -m "fix(schema): freshPushSchema never drops tables outside its schema"
```

---

## Task 3: DB-backed regression — user table survives a real core push (SQLite)

This is the proof the original bug is dead: a real in-memory SQLite DB, a real `dc_articles` table with a row, then `freshPushSchema` with the **core-only** bundle — the row must survive.

**Files:**
- Create: `packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.drop-guard.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// Regression: freshPushSchema with a core-only schema must NOT drop user
// (dc_/single_/comp_) tables. Pre-fix, drizzle-kit's pushSchema emitted
// DROP TABLE dc_articles (extraneous vs the core schema) and freshPushSchema
// executed it, wiping all collection content on every `nextly migrate` that
// reconciled core. Uses a real in-memory SQLite DB + real drizzle-kit.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../../database/index";

import { freshPushSchema } from "../fresh-push";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("freshPushSchema drop-guard (real SQLite)", () => {
  it("preserves a user dc_ table + its row when pushing the core schema", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A user collection table with content — exactly what the bug destroyed.
    sqlite.exec(
      'CREATE TABLE "dc_articles" ("id" text PRIMARY KEY, "title" text)'
    );
    db.run(sql`INSERT INTO "dc_articles" ("id", "title") VALUES ('a1', 'Hello')`);

    // Push the core-only bundle (this is what reconcileCore's applyCore does).
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));

    // The table and row must still be there.
    const rows = db.all(
      sql`SELECT "id", "title" FROM "dc_articles"`
    ) as Array<{ id: string; title: string }>;
    expect(rows).toEqual([{ id: "a1", title: "Hello" }]);

    // And the guard logged that it blocked the drop.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/pipeline/__tests__/fresh-push.drop-guard.integration.test.ts`
Expected: PASS. (Sanity check the fix is what makes it pass: temporarily `git stash` the `fresh-push.ts` change and re-run — it should FAIL with `dc_articles` empty/missing — then `git stash pop`. Optional but recommended.)

- [ ] **Step 3: Commit**

```bash
git add packages/nextly/src/domains/schema/pipeline/__tests__/fresh-push.drop-guard.integration.test.ts
git commit -m "test(schema): regression proving core push preserves user tables"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the full nextly test suite**

Run: `corepack pnpm --filter nextly exec vitest run`
Expected: PASS. Pay attention to: `pushschema-pipeline.test.ts`, `fresh-push.test.ts`, `core-reconcile.test.ts`, `reload-config` tests, and any `*.integration.test.ts` that exercise pushSchema.

- [ ] **Step 2: Lint + typecheck**

Run: `corepack pnpm --filter nextly lint && corepack pnpm --filter nextly exec tsc --noEmit`
Expected: zero warnings, zero type errors. If `import-x/order` complains, run `corepack pnpm --filter nextly lint:fix`.

- [ ] **Step 3: Rebuild the CLI bundle (so `nextly migrate` reflects the fix)**

Run: `corepack pnpm --filter nextly build`
Expected: build succeeds; `Root entry is Node-safe`.

- [ ] **Step 4: Manual end-to-end check against isolated SQLite (NOT Neon)**

Using a throwaway SQLite DB (`DATABASE_URL=file:/tmp/nextly-dropguard.db DB_DIALECT=sqlite`), reproduce the migrate scenario from the prior E2E: create a collection, run `nextly migrate`, insert a row into its `dc_*` table, run `nextly migrate` again, and confirm the row survives. **Never point this at the real Neon Postgres DB.**

- [ ] **Step 5: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)

- **Spec coverage:** Unit 1 → Task 1; Unit 2 (SQL-name derivation + all three paths + PG tx) → Task 2; test plan items 1-2 → Task 1, item 3 (user survives + core allowed) → Task 1 (allow-branch unit test) + Task 3 (DB-backed survival), item 4 (pipeline regression) → Task 1 Step 6. Covered.
- **Behavior-change risk:** the only intended behavior change beyond dropping fewer statements is PG moving off `result.apply()`. Existing PG unit tests are explicitly rewritten in Task 2 Step 1 to match. The dev-server path is unchanged (Task 1 is a pure move + delegate).
- **Type consistency:** `filterUnsafeStatements(statements, desiredTableNames)`, `drizzleTableNames(schema)`, `isDrizzleTable(value)`, `getDrizzleTableName(value, fallback)` — signatures identical across module, pipeline call sites, and fresh-push usage.
