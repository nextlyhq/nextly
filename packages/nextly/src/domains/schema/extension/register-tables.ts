/**
 * Registering the compiled extension tables with the schema registry.
 *
 * The registry is what the adapter resolves a table through and what
 * assembles the relations config behind `db.query`, so a table missing from it
 * is missing from `ctx.db.query` however correctly it was compiled and
 * created. Boot and an HMR reload both register through here: registration
 * used to happen on reload alone, so after a plain boot no extension table
 * could be queried relationally until the config was edited.
 *
 * @module domains/schema/extension/register-tables
 */
import type { DynamicRelationEdge } from "../../../database/schema-registry";

import type { ExtensionSchema } from "./build-extension-schema";

/** The two registry methods registration needs. */
export interface ExtensionTableRegistry {
  registerDynamicSchema(
    tableName: string,
    table: unknown,
    edges?: DynamicRelationEdge[]
  ): void;
  retractDynamicSchema(tableName: string): void;
}

/**
 * The extension tables each registry currently holds, so the next
 * registration can retract the ones the config has stopped declaring. Keyed by
 * registry rather than held in one variable, so a second registry in the same
 * process — a test boot, a re-registration — does not inherit another's set.
 */
const registeredBy = new WeakMap<ExtensionTableRegistry, Set<string>>();

/**
 * Register every compiled and adopted extension table, and retract any this
 * registry held before that the schema no longer declares.
 *
 * A retracted table fails loudly as unknown rather than reaching a table the
 * pipeline has stopped maintaining. `schema` absent means nothing declares an
 * extension table, so everything previously registered is retracted.
 */
export function registerExtensionTables(
  registry: ExtensionTableRegistry,
  schema: ExtensionSchema | null | undefined
): void {
  const current = new Set<string>();
  for (const [tableName, table] of Object.entries(schema?.drizzle ?? {})) {
    registry.registerDynamicSchema(
      tableName,
      table,
      schema?.relations.get(tableName)
    );
    current.add(tableName);
  }
  // Adopted tables register the same way — typed access and queries — but
  // never enter the desired set, so nothing downstream manages them.
  for (const [tableName, table] of Object.entries(schema?.adopted ?? {})) {
    registry.registerDynamicSchema(
      tableName,
      table,
      schema?.adoptedRelations.get(tableName)
    );
    current.add(tableName);
  }
  for (const tableName of registeredBy.get(registry) ?? []) {
    if (!current.has(tableName)) registry.retractDynamicSchema(tableName);
  }
  registeredBy.set(registry, current);
}
