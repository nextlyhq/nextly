/**
 * Which changed singletons fail a file, apart from `shared-module-guards.ts`,
 * which registers hooks when it loads, so that the rule can be tested without
 * registering them a second time.
 */

/**
 * Singletons that only cache immutable modules a file asked for: the loaded
 * dialects' tables. A file that loads another dialect leaves nothing a later
 * file could depend on that it would not get by loading it too, so it is put
 * back after the file like every other singleton, which keeps a file from
 * passing only because an earlier one loaded a dialect, but is not a failure.
 *
 * Named exactly, not by pattern: a change to any other `__nextly*` singleton,
 * one whose name merely begins with this one's included, still fails the file.
 */
export const RESTORED_QUIETLY: ReadonlySet<string> = new Set([
  "__nextly_dialectTables",
]);

/** The report names of the changed singletons a file is failed for. */
export function failingSingletons(
  changed: ReadonlyArray<{ key: string; label: string }>
): string[] {
  return [
    ...new Set(
      changed
        .filter(kept => !RESTORED_QUIETLY.has(kept.key))
        .map(kept => kept.label)
    ),
  ];
}
