/**
 * The install's store, as `nextly setup-token` reads and writes it.
 *
 * Its own module, imported once a run needs the store: `--generate` touches
 * nothing, and this loads the database's tables and dialects.
 *
 * @module cli/commands/setup-token-store
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { SetupTokenMeta } from "../../auth/setup-token/setup-token";
import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { MetaService } from "../../domains/meta/services/meta-service";
import { superAdminRoleHeld } from "../../domains/users/services/last-super-admin";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";

/** Where the setup token is kept, and whether the install has an administrator. */
export function setupTokenStore(
  adapter: CLIDatabaseAdapter,
  logger: CommandContext["logger"]
): { meta: SetupTokenMeta; hasAdministrator: () => Promise<boolean> } {
  // The tables read here are static system tables, so the static
  // registration alone resolves them.
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const { dialect } = drizzleAdapter.getCapabilities();
  const schemaRegistry = new SchemaRegistry(dialect);
  schemaRegistry.registerStaticSchemas(getDialectTables(dialect));
  drizzleAdapter.setTableResolver(schemaRegistry);
  return {
    meta: new MetaService(drizzleAdapter, logger),
    hasAdministrator: () =>
      superAdminRoleHeld(
        drizzleAdapter.getDrizzle(),
        getDialectTables(dialect)
      ),
  };
}
