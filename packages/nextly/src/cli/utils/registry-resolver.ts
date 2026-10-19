import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";

/**
 * Give the adapter a way to resolve core table NAMES to Drizzle tables.
 *
 * 🔴 Without this, the metadata reconciliation silently does nothing.
 * `adapter.select` maps a name through a resolver and refuses with "not found
 * in schema registry" when none is installed. A CLI run has no boot to install
 * one — which is why `prune`, `webhooks-prune`, `migrate-field-groups` and
 * `dev-server` each wire it up the same way before touching adapter CRUD.
 *
 * Missing here, every registry read in the sweep threw, the per-registry guard
 * caught all three, and the command reported success having repaired nothing:
 * a no-op in exactly the production case the phase exists for.
 *
 * Both spellings of the field-group registry are registered, because a database
 * whose storage migration has run has no handle for it under the other name.
 *
 * Its own exported function so the wiring can be asserted by its OUTCOME — that
 * the registry table resolves — rather than by whether a call appears in the
 * source.
 */
export function installRegistryResolver(
  adapter: DrizzleAdapter
): SchemaRegistry {
  const { dialect } = adapter.getCapabilities();
  const schemaRegistry = new SchemaRegistry(dialect);
  schemaRegistry.registerStaticSchemas({
    ...getDialectTables(dialect),
    ...getFieldGroupRegistryAliases(dialect),
  });
  adapter.setTableResolver(schemaRegistry);
  return schemaRegistry;
}
