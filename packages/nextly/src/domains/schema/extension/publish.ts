/**
 * The wire between a resolved config and every consumer of the schema.
 *
 * This exists because the rest of the extension surface has no way to run
 * itself. The compiler, the draft, the naming rules and the pipeline merge are
 * all correct in isolation, and every one of them reads
 * `getActiveExtensionSchema` — so until something CALLS the compiler and
 * publishes the result, the entire feature compiles, validates, records
 * ownership and creates nothing.
 *
 * It did exactly that. Unit tests all passed because each one built a schema
 * and passed it in; not one asked whether boot does. The first integration
 * test failed with `no such table` on all three dialects.
 *
 * @module domains/schema/extension/publish
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { pluginAdminSlug } from "../../../plugins/plugin-slug";
import { CORE_TABLE_NAMES } from "../../../schemas";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import { resolveComponentTableName } from "../utils/resolve-table-name";

import type { DrizzleSchemaHook } from "./after-drizzle";
import {
  buildExtensionSchema,
  clearActiveExtensionSchema,
  type ExtensionSchema,
  setActiveExtensionSchema,
} from "./build-extension-schema";
import type { SeedEntityTable } from "./draft";
import { pluginTablePrefix } from "./naming";
import type { SchemaContribution } from "./run-hooks";

interface PublishInput {
  dialect: SupportedDialect;
  /** Enabled and disabled alike; disabled ones contribute nothing. */
  plugins: readonly PluginDefinition[];
  /**
   * The transformed service config.
   *
   * Read structurally rather than typed against `NextlyServiceConfig`: this
   * module needs two fields from it, and naming the whole type here would
   * couple the schema layer to the container's config shape.
   */
  config: {
    collections?: readonly unknown[];
    // Seeded alongside collections, because a hook may target any entity
    // table and the draft accepts all three kinds.
    singles?: readonly unknown[];
    fieldGroups?: readonly unknown[];
    db?: unknown;
  };
  logger: { warn: (message: string) => void; debug?: (m: string) => void };
}

/**
 * The prefix each enabled plugin's tables carry.
 *
 * Resolved once here rather than per table, because the prefix must be unique
 * across plugins and that is a property of the SET — asking per table would
 * never see the collision.
 */
function resolvePrefixes(
  plugins: readonly PluginDefinition[]
): Map<string, string> {
  const prefixes = new Map<string, string>();
  const claimed = new Map<string, string>();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    if (!plugin.contributes?.schema) continue;

    const prefix = pluginTablePrefix(
      plugin.name,
      plugin.contributes.schema.prefix,
      pluginAdminSlug
    );
    const existing = claimed.get(prefix);
    if (existing !== undefined && existing !== plugin.name) {
      // Named on both sides. A collision reported against one plugin leaves
      // the operator guessing which other one took the name.
      throw NextlyError.validation({
        errors: [
          {
            path: `plugin.${plugin.name}.schema.prefix`,
            code: "INVALID",
            message: `Plugins "${existing}" and "${plugin.name}" both claim the schema prefix "${prefix}". Declare contributes.schema.prefix on one of them.`,
          },
        ],
      });
    }
    claimed.set(prefix, plugin.name);
    prefixes.set(plugin.name, prefix);
  }
  return prefixes;
}

/** What each enabled plugin contributes, in the order the resolver placed it. */
function contributionsOf(
  plugins: readonly PluginDefinition[]
): SchemaContribution[] {
  const out: SchemaContribution[] = [];
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const schema = plugin.contributes?.schema;
    if (!schema) continue;

    out.push({
      owner: { kind: "plugin", id: plugin.name },
      ...(schema.tables ? { tables: schema.tables } : {}),
      ...(schema.extend ? { extend: schema.extend } : {}),
    });
  }
  return out;
}

/**
 * Compile the extension schema and make it the active one.
 *
 * Called at boot before the schema syncs, and again on every HMR reload — the
 * compiled result is what the push pipeline merges, so a stale one describes a
 * schema the config no longer asks for.
 */
export async function compileAndPublishExtensionSchema(
  input: PublishInput
): Promise<ExtensionSchema | undefined> {
  const plugins = contributionsOf(input.plugins);
  const schemaConfig = (
    input.config.db as
      | { schema?: { extend?: unknown[]; afterDrizzle?: DrizzleSchemaHook[] } }
      | undefined
  )?.schema;
  const appHooks = schemaConfig?.extend ?? [];
  // Counted in the early return below: an app that declares ONLY afterDrizzle
  // still has something to compile, and clearing the schema there would drop
  // the tables its hook was written to reshape.
  const afterDrizzle = schemaConfig?.afterDrizzle ?? [];

  if (
    plugins.length === 0 &&
    appHooks.length === 0 &&
    afterDrizzle.length === 0
  ) {
    // Nothing declares a schema. Cleared rather than left alone, so a reload
    // that REMOVES the last plugin does not leave its tables in the desired
    // set — which would keep re-creating them.
    clearActiveExtensionSchema();
    return undefined;
  }

  // All three entity kinds, not collections alone. A hook may index or extend
  // a single or a field group exactly as it may a collection — the draft
  // accepts `single_*` and `comp_*` as entity targets, and the desired-spec
  // side carries contributed columns for all three — but a table absent from
  // this seed is one `getTable` cannot find, so the hook failed at boot with
  // "Table ... does not exist" before any of that could run.
  //
  // Names come from the canonical resolvers rather than from a prefix spelled
  // here: a single may carry a `dbName`, and a field group's prefix is a
  // storage-format constant. Spelling either by hand is how the seed comes to
  // disagree with the table the pipeline actually creates.
  const collections = (input.config.collections ?? []) as {
    slug: string;
  }[];
  const singles = (input.config.singles ?? []) as {
    slug: string;
    dbName?: string;
  }[];
  const fieldGroups = (input.config.fieldGroups ?? []) as {
    slug: string;
  }[];

  // Columns are seeded empty for every kind: a hook looks a table UP to check
  // it exists and to index it, and the diff derives the real columns from the
  // fields. Listing them here would be a second derivation of the same thing,
  // and the one that drifts is the one nobody reads.
  const entities: SeedEntityTable[] = [
    ...collections.map(collection => ({
      name: `dc_${collection.slug}`,
      slug: collection.slug,
      entityKind: "collection" as const,
      columns: [],
    })),
    ...singles.map(single => ({
      name: resolveSingleTableName(single),
      slug: single.slug,
      entityKind: "single" as const,
      columns: [],
    })),
    ...fieldGroups.map(group => ({
      name: resolveComponentTableName(group.slug),
      slug: group.slug,
      entityKind: "component" as const,
      columns: [],
    })),
  ];

  const schema = await buildExtensionSchema({
    dialect: input.dialect,
    coreTableNames: CORE_TABLE_NAMES,
    entities,
    pluginPrefixes: resolvePrefixes(input.plugins),
    // Who may index whose tables: hard and optional dependencies both count,
    // because both let the resolver order the pair and refuse an
    // incompatible version. Derived here from the definitions the resolver
    // already accepted.
    dependencies: new Map(
      input.plugins.map(plugin => [
        plugin.name,
        new Set([
          ...Object.keys(plugin.dependsOn ?? {}),
          ...Object.keys(plugin.optionalDependsOn ?? {}),
        ]),
      ])
    ),
    plugins,
    afterDrizzle,
    ...(appHooks.length > 0
      ? {
          app: {
            owner: { kind: "app" as const },
            extend: appHooks as SchemaContribution["extend"],
          },
        }
      : {}),
  });

  setActiveExtensionSchema(input.dialect, schema);
  input.logger.debug?.(
    `[nextly] extension schema: ${String(schema.tables.length)} table(s) from ${String(plugins.length)} plugin(s).`
  );
  // RETURNED as well as published, so a caller in the same boot can hand it
  // to first-run directly. The module-level map is reached through a dynamic
  // import there, and a bundler may resolve that to a second instance of this
  // module — whose map is empty. Measured: publish logged two tables and
  // first-run read none, in one process, microseconds apart.
  return schema;
}
