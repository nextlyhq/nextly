import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";
import { PLUGIN_NAME } from "../admin-contract";

import { migrations } from "./migrations";
import { ACCOUNTS_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

// The package's name, under which Nextly records the plugin's tables and
// migrations; declared with the rest of what the admin screens share.
export { PLUGIN_NAME };

/** The type of {@link accountsSchema}: each member read from where it is declared. */
type AccountsSchema = {
  prefix: string;
  tables: (typeof ACCOUNTS_TABLES)[number][];
  migrations: typeof migrations;
};

/**
 * The plugin's schema contribution: its tables and the migration modules that
 * create them, so there is one declaration of the accounts schema.
 */
export const accountsSchema: AccountsSchema = {
  prefix: SCHEMA_PREFIX,
  tables: [...ACCOUNTS_TABLES],
  migrations,
};

/**
 * The plugin as `nextly migrate:create --plugin ./src/schema/definition.ts`
 * reads it: its name, version and schema, without the options a site passes,
 * which change no table. Generated modules are written beside this file, in
 * `./migrations`.
 */
// The assertion states the default export's type, which `isolatedDeclarations`
// cannot infer from a call; the type checker sees it as already that type.
// oxlint-disable-next-line typescript/no-unnecessary-type-assertion
export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: accountsSchema },
}) satisfies PluginDefinition as PluginDefinition;
