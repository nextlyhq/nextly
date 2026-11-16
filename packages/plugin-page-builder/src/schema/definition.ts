/**
 * The page builder's schema contribution, and the plugin as
 * `nextly migrate:create --plugin ./src/schema/definition.ts` reads it.
 *
 * The plugin itself (`pageBuilder()`) contributes exactly
 * {@link pageBuilderSchema}, so there is one declaration of its tables.
 * Generated modules are written beside this file, in `./migrations`.
 *
 * @module schema/definition
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import { migrations } from "./migrations";
import { PAGE_BUILDER_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

/** The type of {@link pageBuilderSchema}: each member read from where it is declared. */
type PageBuilderSchema = {
  prefix: string;
  tables: (typeof PAGE_BUILDER_TABLES)[number][];
  migrations: typeof migrations;
};

/** The tables this plugin declares and the migration modules that create them. */
export const pageBuilderSchema: PageBuilderSchema = {
  prefix: SCHEMA_PREFIX,
  tables: [...PAGE_BUILDER_TABLES],
  migrations,
};

/**
 * The plugin's name, version and schema, without the options a site passes to
 * `pageBuilder()`, which change no table. `pageBuilder()` reads its schema
 * version from here, so the version the plugin declares is the one its
 * migrations were generated for.
 */
export const pageBuilderSchemaPlugin: PluginDefinition = definePlugin({
  name: PAGE_BUILDER_PLUGIN_NAME,
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: pageBuilderSchema },
});
