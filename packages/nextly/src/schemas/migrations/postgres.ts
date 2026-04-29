/**
 * PostgreSQL Schema for Migration Tracking (F11)
 *
 * Defines the `nextly_migrations` table for PostgreSQL using Drizzle ORM.
 * One row per `.sql` migration file applied via `nextly migrate`.
 *
 * NOTE: distinct from `nextly_migration_journal` (F8 PR 5) which logs
 * runtime HMR/UI applies. See plans/specs/F11-migration-files-cli-design.md
 * §3 for the two-table separation.
 *
 * @module schemas/migrations/postgres
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   nextlyMigrationsPg,
 *   type NextlyMigrationPg,
 *   type NextlyMigrationInsertPg,
 * } from '@nextly/schemas/migrations/postgres';
 *
 * await db.insert(nextlyMigrationsPg).values({
 *   filename: '20260429_154500_123_add_excerpt.sql',
 *   sha256: 'abc123…',
 *   status: 'applied',
 *   appliedBy: 'github-actions-12345',
 *   durationMs: 42,
 * });
 * ```
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  char,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";

import type { MigrationRecordStatus } from "../dynamic-collections/types";

// ============================================================
// Nextly Migrations Table (PostgreSQL) — F11 schema
// ============================================================

/**
 * PostgreSQL `nextly_migrations` table.
 *
 * Per the F11 spec (§7), columns capture everything an operator needs
 * to debug a production deploy: structured `errorJson`, `appliedBy`
 * actor, `durationMs` for ops visibility, and a reserved `rollbackSql`
 * column for the future v2 corrective-rollback feature.
 *
 * `status` is constrained to `'applied' | 'failed'` only — the spec
 * deliberately drops `'pending'` because rows are inserted ONLY after
 * the apply attempt completes (no transient pending state on disk).
 */
export const nextlyMigrationsPg = pgTable(
  "nextly_migrations",
  {
    /** UUID v4, generated server-side. */
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Migration filename (without directory). Unique.
     *
     * @example "20260429_154500_123_add_excerpt.sql"
     */
    filename: text("filename").notNull().unique(),

    /**
     * SHA-256 of the .sql file content as written. 64 hex chars.
     * Used by `nextly migrate` to detect tampering on subsequent runs
     * and by `nextly migrate:check` (via the paired snapshot file).
     */
    sha256: char("sha256", { length: 64 }).notNull(),

    /**
     * When the migration was applied to this database. Timezone-aware
     * for cross-region operator clarity.
     */
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Who/what ran the migration. Resolved by the CLI from
     * `NEXTLY_APPLIED_BY` → `GITHUB_ACTOR` → `USER` → hostname.
     */
    appliedBy: text("applied_by"),

    /** Wall-clock duration of the apply, in milliseconds. */
    durationMs: integer("duration_ms"),

    /**
     * Apply outcome. Only `'applied'` or `'failed'`; rows are inserted
     * only after the attempt completes. CHECK constraint enforces this.
     */
    status: text("status").notNull().$type<MigrationRecordStatus>(),

    /**
     * Structured error info on failure. Shape:
     * `{ sqlState?: string; statement?: string; message: string }`.
     * NULL on success.
     */
    errorJson: jsonb("error_json"),

    /**
     * Reserved for v2 corrective-rollback feature. Always NULL in v1.
     * Column exists so future ALTER TABLE ADDs from F15 don't conflict.
     */
    rollbackSql: text("rollback_sql"),
  },
  table => [
    /** Most-recent-first queries on the operator dashboard. */
    index("nextly_migrations_applied_at_idx").on(table.appliedAt),

    /** Enforce the two-state lifecycle at the DB level. */
    check(
      "nextly_migrations_status_check",
      sql`${table.status} IN ('applied', 'failed')`
    ),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/** Full row type for SELECT queries. */
export type NextlyMigrationPg = typeof nextlyMigrationsPg.$inferSelect;

/** Insert shape for INSERT queries. `id` and `appliedAt` have defaults. */
export type NextlyMigrationInsertPg = typeof nextlyMigrationsPg.$inferInsert;
