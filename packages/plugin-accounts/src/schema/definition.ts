import { definePlugin } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";
import { PLUGIN_NAME } from "../admin-contract";

import { migrations } from "./migrations";
import { ACCOUNTS_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

// The package's name, under which Nextly records the plugin's tables and
// migrations; declared with the rest of what the admin screens share.
export { PLUGIN_NAME };

/**
 * The plugin's schema contribution: its tables and the migration modules that
 * create them, so there is one declaration of the accounts schema.
 */
export const accountsSchema = {
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
export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: accountsSchema },
});
