// Dialect-agnostic types for the `nextly_migration_journal` table.
//
// F8 PR 5: introduces the journal that records every pipeline apply
// (success, failure, abort) so admins + future tooling can audit
// schema changes. Distinct from `nextly_migrations` (the file-based
// migration ledger used by `nextly migrate` / `nextly migrate:status`).

/**
 * Origin of the schema apply, surfaced in the journal so admins can
 * tell HMR-driven changes apart from admin-UI-driven changes etc.
 *
 * Today the pipeline emits `'ui'` or `'code'`; future PRs may extend
 * to `'init'` (boot-time auto-sync), `'fresh'` (`migrate:fresh`), or
 * `'cli'` (`nextly migrate:create` etc.) once those flows route
 * through the journal too.
 */
export type MigrationJournalSource = "ui" | "code";

/**
 * Lifecycle state of a journal row. A row starts at `'in_progress'`
 * (recordStart) and transitions to one of the terminal states on
 * recordEnd. Rows that stay at `'in_progress'` for longer than a
 * dev cycle indicate a crash mid-apply — admins should investigate.
 */
export type MigrationJournalStatus =
  | "in_progress"
  | "success"
  | "failed"
  | "aborted";

/**
 * F10: scope of the apply, surfaced in the journal so the admin
 * NotificationCenter can render rows like "Posts schema updated"
 * vs "Authors single updated" vs "Fresh push (initial setup)".
 *
 * Nullable in the table for forward-compat with rows written before
 * the F10 PR 1 column migration ran.
 */
export type MigrationJournalScopeKind =
  | "collection"
  | "single"
  | "global"
  | "fresh-push";
