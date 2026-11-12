/**
 * The extension schema a command compiles to learn what depends on
 * collections it is about to remove.
 *
 * A command that removes code-first collections (`nextly prune`,
 * `migrate:create` writing their drops) runs where the collections are no
 * longer configured. A plugin hook that still extends one of their tables
 * then has nothing to extend, and the compile refuses before saying what the
 * hook adds. So the removed collections are compiled back in, by their
 * tables: whatever a hook adds to them is in the result, with its
 * contributor, and the delete can be refused by name.
 *
 * Compiled, never published: a command serves nothing, and a schema holding
 * collections the configuration no longer declares must not become the one
 * any other reader in the process sees.
 *
 * @module domains/collections/services/collection-dependents-schema
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import type { ExtensionSchemaRecord } from "../../schema/ownership/dependent-elements";

/** A collection, Single or field group being removed, as the compile seeds its table. */
export interface RemovedCollectionSeed {
  /** Which kind of entity the table was; a collection unless said. */
  kind?: "collection" | "single" | "fieldGroup";
  slug: string;
  tableName: string;
  /** Its fields where they are still known; a seed without them has only system columns. */
  fields?: readonly unknown[];
}

/** The configuration entry that compiles back to a removed entity's table. */
function seedEntry(seed: RemovedCollectionSeed): Record<string, unknown> {
  // A collection's and a Single's `dbName` is the table itself, so the seed has the name the
  // table has, whatever its slug resolved to when it was created. A field group's table follows
  // from its slug alone, and the slug read off the table resolves back to it.
  return seed.kind === "fieldGroup"
    ? { slug: seed.slug, fields: seed.fields ?? [] }
    : { slug: seed.slug, dbName: seed.tableName, fields: seed.fields ?? [] };
}

/**
 * Compile the configured extension schema with `removedCollections` seeded
 * beside the configured collections. `null` when nothing declares a schema.
 */
export async function compileExtensionSchemaWith(input: {
  config: {
    plugins?: readonly PluginDefinition[];
    collections?: readonly unknown[];
    singles?: readonly unknown[];
    fieldGroups?: readonly unknown[];
    db?: unknown;
  };
  dialect: SupportedDialect;
  removedCollections: readonly RemovedCollectionSeed[];
  logger: { warn: (message: string) => void };
}): Promise<ExtensionSchemaRecord | null> {
  const { compileExtensionSchema } = await import(
    "../../schema/extension/publish"
  );
  const schema = await compileExtensionSchema({
    dialect: input.dialect,
    plugins: input.config.plugins ?? [],
    config: {
      ...input.config,
      collections: [
        ...(input.config.collections ?? []),
        ...seedsOf(input.removedCollections, "collection"),
      ],
      singles: [
        ...(input.config.singles ?? []),
        ...seedsOf(input.removedCollections, "single"),
      ],
      fieldGroups: [
        ...(input.config.fieldGroups ?? []),
        ...seedsOf(input.removedCollections, "fieldGroup"),
      ],
    },
    logger: input.logger,
  });
  return schema ?? null;
}

/** The configuration entries of the removed entities of one kind. */
function seedsOf(
  seeds: readonly RemovedCollectionSeed[],
  kind: NonNullable<RemovedCollectionSeed["kind"]>
): Record<string, unknown>[] {
  return seeds
    .filter(seed => (seed.kind ?? "collection") === kind)
    .map(seedEntry);
}
