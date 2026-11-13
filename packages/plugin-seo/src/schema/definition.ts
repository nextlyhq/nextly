/**
 * The SEO plugin's schema contribution, and the plugin as
 * `nextly migrate:create --plugin ./src/schema/definition.ts` reads it.
 *
 * The plugin itself (`seoPlugin()`) contributes exactly {@link seoSchema},
 * so there is one declaration of its tables. Generated modules are written
 * beside this file, in `./migrations`.
 *
 * @module schema/definition
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";

import { migrations } from "./migrations";
import { SCHEMA_PREFIX, SCHEMA_VERSION, SEO_TABLES } from "./tables";

/** The type of {@link seoSchema}: each member read from where it is declared. */
type SeoSchema = {
  prefix: string;
  tables: (typeof SEO_TABLES)[number][];
  migrations: typeof migrations;
};

/** The tables this plugin declares and the migration modules that create them. */
export const seoSchema: SeoSchema = {
  prefix: SCHEMA_PREFIX,
  tables: [...SEO_TABLES],
  migrations,
};

/**
 * The plugin's name, version and schema, without the options a site passes to
 * `seoPlugin()`, which change no table. `seoPlugin()` reads its schema version
 * from here, so the version the plugin declares is the one its migrations
 * were generated for.
 */
export const seoSchemaPlugin: PluginDefinition = definePlugin({
  name: "@nextlyhq/plugin-seo",
  version: PLUGIN_VERSION,
  nextly: `>=${PLUGIN_VERSION}`,
  schemaVersion: SCHEMA_VERSION,
  contributes: { schema: seoSchema },
});
