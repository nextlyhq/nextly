import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";

import { migrations } from "./migrations";
import { COMMERCE_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

/** The package's name, under which Nextly records commerce's tables and migrations. */
export const PLUGIN_NAME = "@nextlyhq/plugin-commerce";

/** The type of {@link commerceSchema}: each member read from where it is declared. */
type CommerceSchema = {
  prefix: string;
  tables: (typeof COMMERCE_TABLES)[number][];
  migrations: typeof migrations;
};

/**
 * Commerce's schema contribution: its tables and the migration modules that
 * create them. The plugin itself (`commerce()`) contributes exactly this, so
 * there is one declaration of commerce's schema.
 */
export const commerceSchema: CommerceSchema = {
  prefix: SCHEMA_PREFIX,
  tables: [...COMMERCE_TABLES],
  migrations,
};

/**
 * The plugin as `nextly migrate:create --plugin ./src/schema/definition.ts`
 * reads it: its name, version and schema, without the options a site passes
 * to `commerce()`, which change no table. Generated modules are written beside
 * this file, in `./migrations`.
 */
// The assertion states the default export's type, which `isolatedDeclarations`
// cannot infer from a call; the type checker sees it as already that type.
// oxlint-disable-next-line typescript/no-unnecessary-type-assertion
export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: commerceSchema },
}) satisfies PluginDefinition as PluginDefinition;
