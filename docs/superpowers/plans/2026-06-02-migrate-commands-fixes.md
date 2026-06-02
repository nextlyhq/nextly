# Migrate-Command Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four pre-existing defects in the `nextly migrate*` command suite (dry-run crash on fresh DB, migrate:status double-listing, migrate:fresh legacy schema, migrate:resolve no-op re-run).

**Architecture:** Four independent fixes. #4 introduces a shared `newestEvent` helper so `isFileApplied` and `resolve.ts` share one event-sourced "latest wins" rule. #3 deletes an obsolete SQLite special-case so all dialects use the consolidated `runMigrate` path. #1 makes dry-run read-only-tolerant of a missing ledger. #2 normalizes a `.sql` key.

**Tech Stack:** TypeScript, drizzle-orm, Vitest, better-sqlite3 (in-memory for tests).

**Spec:** `docs/superpowers/specs/2026-06-02-migrate-commands-fixes-design.md`

**Branch:** `feat/schema-pipeline/fix-migrate-commands` (already created).

---

## Pre-flight (read once)

- `pnpm` is not on PATH → use `corepack pnpm`.
- Single test file: `corepack pnpm --filter nextly exec vitest run <path>`
- Integration test file (real SQLite, `*.integration.test.ts`): add `--config vitest.integration.config.ts`.
- Lint: `corepack pnpm --filter nextly lint` (zero warnings). Typecheck: `corepack pnpm --filter nextly exec tsc --noEmit`.
- Commits: `--no-verify` OK for these (the branch already has pre-existing red tests; the pre-push hook runs lint+build only). Identity already `aqib-rx`/`aqib.revnix@gmail.com`. **No Claude/AI co-author trailers.**
- The repo unit suite has ~407 PRE-EXISTING failures unrelated to this work (documented). Verification compares the failure delta, not an all-green suite.

---

## Task 1: #4 — `isFileApplied` latest-status-wins (+ shared `newestEvent`)

**Files:**
- Create: `packages/nextly/src/domains/schema/events/newest-event.ts`
- Modify: `packages/nextly/src/domains/schema/events/schema-events-repository.ts`
- Modify: `packages/nextly/src/domains/schema/migrate/resolve.ts`
- Test: `packages/nextly/src/domains/schema/events/__tests__/schema-events-repository.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe("SchemaEventsRepository (sqlite)", …)` block in `schema-events-repository.test.ts`):

```ts
  it("isFileApplied is latest-status-wins: a later rolled_back un-applies it", async () => {
    const id = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0001_init.sql",
    });
    await repo.markApplied(id, {});
    expect(await repo.isFileApplied("0001_init.sql")).toBe(true);

    // What `migrate:resolve --rolled-back` does: append a later rolled_back event.
    await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename: "0001_init.sql",
      startedAt: new Date(Date.now() + 1000),
      endedAt: new Date(Date.now() + 1000),
    });
    expect(await repo.isFileApplied("0001_init.sql")).toBe(false);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/events/__tests__/schema-events-repository.test.ts`
Expected: the new test FAILS — `isFileApplied` still returns `true` after rolled_back (old "any applied row" behavior).

- [ ] **Step 3: Create the shared helper** `packages/nextly/src/domains/schema/events/newest-event.ts`:

```ts
// Event-sourced "current state" rule shared by the migration bookkeeping:
// the newest file_apply event (by startedAt) decides whether a file is applied.
import type { SchemaEventRow } from "./schema-events-repository";

/** The most-recently-started event in the set, or undefined if empty. */
export function newestEvent(
  rows: SchemaEventRow[]
): SchemaEventRow | undefined {
  return [...rows].sort(
    (a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)
  )[0];
}
```

- [ ] **Step 4: Rewrite `isFileApplied`** in `schema-events-repository.ts` to latest-wins. Add the import at the top of the file (with the other local imports):

```ts
import { newestEvent } from "./newest-event";
```

Replace the existing method:

```ts
  /** True iff an applied `file_apply` row exists for the filename. */
  async isFileApplied(filename: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(
        sql`filename = ${filename} AND event_type = 'file_apply' AND status = 'applied'`
      );
    return rows.length > 0;
  }
```

with:

```ts
  /**
   * True iff the file's MOST RECENT `file_apply` event is `applied`. Latest
   * wins: a later `rolled_back` (or `failed`) event un-applies the file so
   * the next `migrate` re-runs it. Mirrors the event-sourced model the
   * resolve command uses (see newest-event.ts).
   */
  async isFileApplied(filename: string): Promise<boolean> {
    const rows = await this.findFileApplies(filename);
    return newestEvent(rows)?.status === "applied";
  }
```

- [ ] **Step 5: Point `resolve.ts` at the shared helper.** In `packages/nextly/src/domains/schema/migrate/resolve.ts`, delete the local `newest` function (lines ~69-73) and add the import (next to the existing `import type { SchemaEventRow }` line):

```ts
import { newestEvent } from "../events/newest-event";
```

Then replace the one call site `const latest = newest(rows);` (in `resolveRolledBack`) with:

```ts
  const latest = newestEvent(rows);
```

- [ ] **Step 6: Run the repo + resolve tests**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/events/__tests__/schema-events-repository.test.ts src/domains/schema/migrate/`
Expected: PASS, including the existing `"isFileApplied returns true only for an applied file_apply row"` test (single applied row → latest is applied → still true) and the new latest-wins test. If any existing assertion encoded the old "any applied row" behavior, update it to the latest-wins expectation.

- [ ] **Step 7: Typecheck + commit**

```bash
corepack pnpm --filter nextly exec tsc --noEmit
git add packages/nextly/src/domains/schema/events/newest-event.ts \
        packages/nextly/src/domains/schema/events/schema-events-repository.ts \
        packages/nextly/src/domains/schema/migrate/resolve.ts \
        packages/nextly/src/domains/schema/events/__tests__/schema-events-repository.test.ts
git commit -m "fix(migrate): isFileApplied honors latest file_apply event (resolve --rolled-back re-runs)" --no-verify
```

---

## Task 2: #2 — `migrate:status` no longer double-lists migrations

**Files:**
- Modify: `packages/nextly/src/cli/commands/migrate-status.ts`
- Test: `packages/nextly/src/cli/commands/__tests__/migrate-status.build-statuses.test.ts` (create)

- [ ] **Step 1: Export the pure function under test.** In `migrate-status.ts`, change `function buildMigrationStatuses(` to `export function buildMigrationStatuses(`. (The test passes structurally-typed object literals, so the `ParsedMigration`/`MigrationRecord` interfaces do NOT need exporting.)

- [ ] **Step 2: Write the failing test** `packages/nextly/src/cli/commands/__tests__/migrate-status.build-statuses.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { buildMigrationStatuses } from "../migrate-status";

describe("buildMigrationStatuses", () => {
  it("reconciles a ledger filename (.sql) with the discovered file name (no ext)", () => {
    const files = [
      {
        name: "20260101_000000_000_init",
        filePath: "/x/20260101_000000_000_init.sql",
        checksum: "abc",
        collections: [],
        timestamp: "20260101_000000",
      },
    ];
    const applied = [
      {
        id: "e1",
        filename: "20260101_000000_000_init.sql", // ledger stores WITH .sql
        sha256: "abc",
        status: "applied" as const,
        appliedBy: null,
        durationMs: 5,
        errorJson: null,
        appliedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    const statuses = buildMigrationStatuses(files, applied);

    // Exactly ONE row, applied — not a "pending" + "applied (file missing)" pair.
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("applied");
    expect(statuses.some(s => s.status === "applied (file missing)")).toBe(
      false
    );
    expect(statuses.some(s => s.status === "pending")).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `corepack pnpm --filter nextly exec vitest run src/cli/commands/__tests__/migrate-status.build-statuses.test.ts`
Expected: FAIL — currently produces 2 rows (`pending` + `applied (file missing)`).

- [ ] **Step 4: Fix the key normalization** in `buildMigrationStatuses`. Replace the map construction + lookups so they compare on the extension-stripped name. Change:

```ts
  const appliedMap = new Map(applied.map(m => [m.filename, m]));
```

to:

```ts
  const stripSql = (f: string): string => f.replace(/\.sql$/i, "");
  const appliedMap = new Map(applied.map(m => [stripSql(m.filename), m]));
```

and inside the `for (const file of files)` loop change `appliedMap.get(file.name)` → `appliedMap.get(stripSql(file.name))` and `appliedMap.delete(file.name)` → `appliedMap.delete(stripSql(file.name))`. (file.name is already extension-less, but `stripSql` is harmless and keeps both sides symmetric.)

- [ ] **Step 5: Run the test + existing migrate-status tests**

Run: `corepack pnpm --filter nextly exec vitest run src/cli/commands/__tests__/migrate-status.build-statuses.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
corepack pnpm --filter nextly exec tsc --noEmit
git add packages/nextly/src/cli/commands/migrate-status.ts \
        packages/nextly/src/cli/commands/__tests__/migrate-status.build-statuses.test.ts
git commit -m "fix(migrate): migrate:status reconciles .sql ledger names (no double-listing)" --no-verify
```

---

## Task 3: #1 — `migrate --dry-run` tolerates a missing ledger on a fresh DB

**Files:**
- Modify: `packages/nextly/src/cli/commands/migrate.ts`
- Test: `packages/nextly/src/cli/commands/__tests__/migrate.find-pending.integration.test.ts` (create)

- [ ] **Step 1: Export + re-signature `findPendingFiles`.** In `migrate.ts`, change the function so it receives the adapter (for `tableExists`) and short-circuits when the ledger is absent. Replace:

```ts
/** Discover migration files with no applied `file_apply` event yet. */
async function findPendingFiles(
  db: unknown,
  dialect: SupportedDialect,
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<ParsedMigration[]> {
  const all = await discoverMigrations(migrationsDir, logger, "app");
  const repo = new SchemaEventsRepository(db, dialect);
  const pending: ParsedMigration[] = [];
  for (const m of all) {
    if (!(await repo.isFileApplied(`${m.name}.sql`))) pending.push(m);
  }
  return pending;
}
```

with:

```ts
/**
 * Discover migration files with no applied `file_apply` event yet. On a fresh
 * DB the ledger table does not exist yet (only the real `migrate` bootstraps
 * it in Phase 1); dry-run must stay read-only, so if the ledger is absent we
 * report every discovered file as pending rather than querying (and throwing).
 */
export async function findPendingFiles(
  adapter: CLIDatabaseAdapter,
  db: unknown,
  dialect: SupportedDialect,
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<ParsedMigration[]> {
  const all = await discoverMigrations(migrationsDir, logger, "app");
  const hasLedger = await (
    adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  if (!hasLedger) return all;

  const repo = new SchemaEventsRepository(db, dialect);
  const pending: ParsedMigration[] = [];
  for (const m of all) {
    if (!(await repo.isFileApplied(`${m.name}.sql`))) pending.push(m);
  }
  return pending;
}
```

- [ ] **Step 2: Update the dry-run call site** in `runMigrate` (the `if (options.dryRun)` block). Change:

```ts
      const pending = await findPendingFiles(
        db,
        dialect,
        appMigrationsDir,
        logger
      );
```

to:

```ts
      const pending = await findPendingFiles(
        adapter,
        db,
        dialect,
        appMigrationsDir,
        logger
      );
```

- [ ] **Step 3: Write the failing test** `packages/nextly/src/cli/commands/__tests__/migrate.find-pending.integration.test.ts`:

```ts
// #1 regression: findPendingFiles must not throw when the ledger table is
// absent (fresh DB), and must report all discovered files as pending.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findPendingFiles } from "../migrate";

let dir: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const logger = {
  warn: () => {},
  debug: () => {},
} as unknown as Parameters<typeof findPendingFiles>[4];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-"));
  writeFileSync(join(dir, "20260101_000000_000_init.sql"), "-- UP\nSELECT 1;");
  sqlite = new Database(":memory:");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("findPendingFiles (fresh DB, no ledger)", () => {
  it("returns all files as pending without throwing when ledger is absent", async () => {
    const adapter = {
      tableExists: async () => false,
    } as unknown as Parameters<typeof findPendingFiles>[0];

    const pending = await findPendingFiles(adapter, db, "sqlite", dir, logger);

    expect(pending.map(p => p.name)).toEqual(["20260101_000000_000_init"]);
  });
});
```

- [ ] **Step 4: Run it to verify it passes** (the fix is already in from Steps 1-2; this test would have thrown against the old 4-arg signature / ledger query):

Run: `corepack pnpm --filter nextly exec vitest run --config vitest.integration.config.ts src/cli/commands/__tests__/migrate.find-pending.integration.test.ts`
Expected: PASS. (Cross-check optional: temporarily restore the old `for … isFileApplied` body without the `hasLedger` guard and a `tableExists:async()=>true` adapter → it throws `no such table`.)

- [ ] **Step 5: Typecheck + commit**

```bash
corepack pnpm --filter nextly exec tsc --noEmit
git add packages/nextly/src/cli/commands/migrate.ts \
        packages/nextly/src/cli/commands/__tests__/migrate.find-pending.integration.test.ts
git commit -m "fix(migrate): migrate --dry-run tolerates missing ledger on fresh DB" --no-verify
```

---

## Task 4: #3 — `migrate:fresh` drops the legacy SQLite special-case

**Files:**
- Modify: `packages/nextly/src/cli/commands/migrate-fresh.ts`

- [ ] **Step 1: Remove the SQLite special-case branch.** In `runMigrateFresh` (Step 6 region), replace:

```ts
    // Check if bundled migrations exist for this dialect
    const hasBundledMigrations = await checkBundledMigrationsExist(dialect);

    if (!hasBundledMigrations && dialect === "sqlite") {
      // For SQLite without bundled migrations, push schema directly using Drizzle
      logger.info(
        "No bundled migrations found for SQLite. Pushing schema directly..."
      );
      logger.newline();

      await pushSqliteSchema(adapter as unknown as DrizzleAdapter, context);
    } else {
      logger.info("Running all migrations...");
      logger.newline();

      // Run migrations using the existing migrate command logic
      await runMigrate(
        {
          config: options.config,
          verbose: options.verbose,
          quiet: options.quiet,
          cwd: options.cwd,
        },
        context
      );
    }
```

with:

```ts
    logger.info("Running all migrations...");
    logger.newline();

    // All dialects reconcile through the consolidated migrate path:
    // Phase 1 creates core tables from getDialectTables (single source of
    // truth) + bootstraps the nextly_schema_events ledger; Phase 2 applies
    // user migration files. (The old SQLite "push hardcoded DDL directly"
    // special-case created legacy nextly_migrations/content_schema_events
    // tables that then tripped the Phase 0 legacy-bookkeeping gate.)
    await runMigrate(
      {
        config: options.config,
        verbose: options.verbose,
        quiet: options.quiet,
        cwd: options.cwd,
      },
      context
    );
```

- [ ] **Step 2: Delete the now-dead helpers.** Remove these three functions entirely from `migrate-fresh.ts` (they are the last functions in the file): `checkBundledMigrationsExist`, `pushSqliteSchema`, `generateSqliteCreateStatements`.

- [ ] **Step 3: Verify no dangling references / unused imports**

Run: `corepack pnpm --filter nextly exec tsc --noEmit && corepack pnpm --filter nextly lint`
Expected: no type errors, no unused-symbol/lint warnings. If `DrizzleAdapter` (or any import) is now unused, remove it; if still used by `dropAllTables`/`reconcileMysqlSchema`, keep it.

- [ ] **Step 4: Commit**

```bash
git add packages/nextly/src/cli/commands/migrate-fresh.ts
git commit -m "fix(migrate): migrate:fresh uses consolidated runMigrate for all dialects (drop legacy SQLite DDL)" --no-verify
```

> Behavior verification for #3 is the CLI E2E in Task 5 (the fix is a deletion; the real proof is fresh→migrate working end-to-end).

---

## Task 5: Verification (suite delta, lint/typecheck/build, CLI E2E, finish)

- [ ] **Step 1: Targeted tests all green**

Run: `corepack pnpm --filter nextly exec vitest run src/domains/schema/events src/domains/schema/migrate src/cli/commands/__tests__/migrate-status.build-statuses.test.ts`
Run (integration): `corepack pnpm --filter nextly exec vitest run --config vitest.integration.config.ts src/cli/commands/__tests__/migrate.find-pending.integration.test.ts`
Expected: PASS.

- [ ] **Step 2: Full-suite failure delta (no NEW failures)**

Run: `corepack pnpm --filter nextly exec vitest run 2>&1 | tail -3`
Expected: failed-test count is ≤ the pre-existing baseline (~407) plus zero new failures attributable to these changes; new passing tests added. If any NEW failure appears in a file these changes touched, fix before proceeding.

- [ ] **Step 3: Lint + typecheck + build**

```bash
corepack pnpm --filter nextly lint
corepack pnpm --filter nextly exec tsc --noEmit
corepack pnpm --filter nextly build
```
Expected: all clean; build prints "Root entry is Node-safe".

- [ ] **Step 4: CLI E2E on isolated SQLite (NEVER Neon).** Recreate the throwaway project and exercise all four fixes. Use cwd with no `.env`; SQLite env explicit.

```bash
# setup
rm -f /tmp/nextly-e2e.db
mkdir -p apps/playground/e2e-tmp/migrations
cat > apps/playground/e2e-tmp/nextly.config.ts <<'EOF'
import { defineConfig, defineCollection, text, textarea } from "nextly/config";
const Articles = defineCollection({
  slug: "articles",
  labels: { singular: "Article", plural: "Articles" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "body" }),
  ],
});
export default defineConfig({ collections: [Articles], db: { migrationsDir: "./migrations" } });
EOF
```

Then, from `apps/playground/e2e-tmp` with `DB_DIALECT=sqlite DATABASE_URL="file:/tmp/nextly-e2e.db"` and `CLI=<repo>/packages/nextly/dist/cli/nextly.mjs`, assert each:
- **#1:** `node $CLI migrate --dry-run` on the fresh DB → exits 0, lists the pending migration, does NOT print `no such table: nextly_schema_events`.
- `node $CLI migrate:create --name init` then `node $CLI migrate` → applies.
- **#2:** `node $CLI migrate:status` → the `init` migration shows once as `Applied` (no `pending` + `applied (file missing)` duplicate).
- **#4:** `node $CLI migrate:resolve --rolled-back 20260101_*_init.sql` (use the real generated name) then `node $CLI migrate` → it RE-APPLIES the file (not "Nothing to migrate").
- **#3:** `node $CLI migrate:fresh --force` then query tables → `nextly_schema_events` present, `nextly_migrations`/`content_schema_events` ABSENT; then `node $CLI migrate` → runs WITHOUT the "Legacy bookkeeping tables detected" abort.

Clean up afterward: `rm -rf apps/playground/e2e-tmp /tmp/nextly-e2e.db`.

- [ ] **Step 5: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)

- **Spec coverage:** #1→Task 3, #2→Task 2, #3→Task 4, #4→Task 1; shared `newestEvent` + resolve update → Task 1; existing-test updates → Task 1 Step 6; testing matrix → Tasks 1-3 + Task 5 E2E. Covered.
- **Type consistency:** `newestEvent(rows: SchemaEventRow[])` used identically in repo + resolve; `findPendingFiles(adapter, db, dialect, dir, logger)` 5-arg signature matches its one call site (Task 3 Step 2); `buildMigrationStatuses(files, applied)` signature unchanged (only exported).
- **Risk note:** #4 changes a shared predicate (3 call sites) — all three are correct under latest-wins per the spec analysis; the full-suite delta (Task 5 Step 2) catches any regression. #3 is a deletion verified by CLI E2E.
