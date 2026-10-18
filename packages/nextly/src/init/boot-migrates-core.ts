/**
 * Whether a production boot runs its migrations itself.
 *
 * Its own module, free of the migration machinery, so the boot can ask the
 * question early (before the run, to tell a check that what it finds missing
 * is about to be created) without loading what the run needs.
 *
 * @module init/boot-migrates-core
 */

/**
 * Whether a production boot with this `db` block runs the migrations itself,
 * core schema included: only in production, and only when opted in.
 */
export function bootMigratesCore(
  db: { runMigrationsOnBoot?: boolean } | undefined
): boolean {
  return (
    process.env.NODE_ENV === "production" && db?.runMigrationsOnBoot === true
  );
}
