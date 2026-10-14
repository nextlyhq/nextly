import { definePlugin } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";

import { migrations } from "./migrations";
import { COMMERCE_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

/** The package's name, under which Nextly records commerce's tables and migrations. */
export const PLUGIN_NAME = "@nextlyhq/plugin-commerce";

/**
 * Commerce's schema contribution: its tables and the migration modules that
 * create them. The plugin itself (`commerce()`) contributes exactly this, so
 * there is one declaration of commerce's schema.
 */
export const commerceSchema = {
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
export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: commerceSchema },
});
