/**
 * Hold the storage migration out for the whole of a Schema Builder change.
 *
 * ## Why this is one function rather than a line in each service
 *
 * Three services change schema — singles, collections and field groups — and each does it from
 * several methods. Restating the exclusion at every one of them is a rule with nine chances to be
 * forgotten, and the ninth is indistinguishable from the other eight until a migration runs. Asking
 * one function means a new method inherits the decision instead of re-making it.
 *
 * ## Why the SERVICE is the right depth
 *
 * The depth has to be where the DDL and the registry row are written TOGETHER. A lock acquired
 * inside the registry service would be taken after the tables had already changed, which samples
 * the state rather than holding it. Taken at the request layer it would have to be restated for
 * every transport that reaches the same operation.
 *
 * ## Where the service is not the depth
 *
 * Not every Schema Builder save reaches a metadata service, so wrapping a service method does not
 * protect every way of invoking the change. `shared/builder-access.ts` enumerates the
 * schema-changing operations in `BUILDER_METHODS`. Two shapes do the work themselves, and each
 * takes this same exclusion at the one depth where its read, its DDL and its registry write meet,
 * rather than a lock of its own:
 *
 * - a dispatcher handler that does the schema work itself instead of calling a service: the
 *   confirmed applies of collections, Singles and field groups, and the user-field changes, whose
 *   definition write and `user_ext` sync are one change;
 * - a standalone route that writes the registry row directly, which changes what describes storage
 *   without touching storage: the published collection and Single schema routes and the user-field
 *   routes. They issue no DDL, so they take the lock where its table exists and never create it.
 *
 * A path that converges on a service later inherits the decision from it; until then the exclusion
 * is taken where that path's two halves are written together, never as a second lock site beside
 * this one.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";

/**
 * Run a schema change holding the schema lock throughout, so no migration of any kind — the
 * field-group storage migration, `nextly migrate`, `db:sync` — runs beside it.
 *
 * `issuesDdl` decides whether the lock table may be CREATED when it is missing, and the two answers
 * are not interchangeable. A path that issues DDL must be able to create it: otherwise a first-ever
 * storage migration could create the table, claim it, and start renaming while this change was
 * already running unprotected. A path that only writes a registry row must not, because creating a
 * table is itself DDL, and a deployment whose application role has DML but no DDL rights would
 * start failing writes that used to succeed. Collections take that second shape outside
 * development, where they record a migration file instead of executing it.
 */
export async function withSchemaChangeExcluded<T>(
  args: {
    /**
     * Absent on an app with no database configured. The services already run in that mode with
     * their statements generated and never executed, so there is nothing to exclude and nothing to
     * exclude it from — running the work unguarded is the same behaviour, not a weaker one.
     */
    adapter: DrizzleAdapter | undefined;
    logger: Logger;
    /** Names the operation in the refusal's log line, so an operator can see what was held off. */
    label: string;
    issuesDdl: boolean;
  },
  work: () => Promise<T>
): Promise<T> {
  const { adapter } = args;
  if (!adapter) return work();

  // Loaded on demand for the reason the services' own imports are: this module is reached from DI
  // registration, and a static import would pull the migration machinery into the boot graph of
  // every process, including those that never change a schema.
  const { withMigrationExcluded } = await import(
    "../../field-groups/migration/sync-guard"
  );

  return withMigrationExcluded(
    {
      adapter,
      logger: args.logger,
      label: args.label,
      mayCreateLock: args.issuesDdl,
      // A schema change holds its claim to the end. The signal does not stop `work`, so releasing
      // here would hand the row to a migration while this change was still writing its DDL and its
      // registry row — neither atomic nor idempotent, and the exact overlap being prevented.
      releaseOnInterrupt: false,
      // Refused at once while a migration holds the schema lock, with a message that tells the
      // editor to save again once it ends: a request is not held open for a minute.
      whenHeld: "refuse",
      refusal: "editor",
    },
    work
  );
}
