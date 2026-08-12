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
 * Each entity is reachable through three transports — the REST dispatcher, the route handlers and
 * the Direct API — and they all converge on the same service method. An exclusion taken at the
 * request layer would have to be repeated per transport and would miss any transport added later;
 * taken here it covers all of them at once.
 *
 * The depth also has to be where the DDL and the registry row are written TOGETHER. A lock acquired
 * inside the registry service would be taken after the tables had already changed, which samples
 * the state rather than holding it.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";

/**
 * Run a schema change with a field-group storage migration excluded throughout.
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
    },
    work
  );
}
