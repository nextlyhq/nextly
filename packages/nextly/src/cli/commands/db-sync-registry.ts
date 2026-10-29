/**
 * The collection registry `db:sync --promote` and `--demote` change, on the environment's
 * database. One place for both, so each ends a missing database or a failed connection with the
 * same error.
 *
 * @module cli/commands/db-sync-registry
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import {
  connectOrExit,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import type { Logger } from "../utils/logger";

export async function openCollectionRegistry(
  logger: Logger
): Promise<CollectionRegistryService> {
  const env = requireDatabaseEnv(logger);
  const adapter = await connectOrExit(
    { dialect: env.dialect, databaseUrl: env.databaseUrl, logger },
    logger
  );
  // The service expects a full DrizzleAdapter; the CLI adapter is structurally compatible. Its
  // progress is debug output here; the logger's methods are closures, so they pass as they are.
  return new CollectionRegistryService(adapter as unknown as DrizzleAdapter, {
    info: logger.debug,
    warn: logger.warn,
    error: logger.error,
    debug: logger.debug,
  });
}
