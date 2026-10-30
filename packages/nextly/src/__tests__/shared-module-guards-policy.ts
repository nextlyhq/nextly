/**
 * Which changed singletons fail a file, apart from `shared-module-guards.ts`,
 * which registers hooks when it loads, so that the rule can be tested without
 * registering them a second time.
 */

/**
 * Singletons a file changes by using them, which a later file cannot depend on,
 * so each is put back after the file like every other singleton, but is not a
 * failure:
 *
 * - The loaded dialects' tables, which only cache immutable modules a file
 *   asked for. A file that loads another dialect leaves nothing a later file
 *   would not get by loading it too; putting it back keeps a file from passing
 *   only because an earlier one loaded a dialect.
 * - The role version this process last read (`services/lib/rbac-epoch`), which
 *   every permission check reads and refreshes, so any file asking one changes
 *   when it was read. A file that depends on its starting value resets it
 *   (`resetEpochForTests`), as it did while the version was module state.
 *
 * Named exactly, not by pattern: a change to any other `__nextly*` singleton,
 * one whose name merely begins with one of these, still fails the file.
 */
export const RESTORED_QUIETLY: ReadonlySet<string> = new Set([
  "__nextly_dialectTables",
  "__nextly_rbacEpoch",
]);

/** The report names of the changed singletons a file is failed for. */
export function failingSingletons(
  changed: ReadonlyArray<{ key: string; label: string }>
): string[] {
  return [
    ...new Set(
      changed
        // A field's slot is keyed by the field, so its singleton is read from
        // the report name, `singleton.field`.
        .filter(kept => !RESTORED_QUIETLY.has(kept.label.split(".", 1)[0]))
        .map(kept => kept.label)
    ),
  ];
}
