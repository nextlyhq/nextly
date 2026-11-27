/**
 * A plugin package's declaration: the `nextly` key of its package.json, its
 * format, reading it, and comparing it with the plugin's own definition.
 *
 * @module plugins/declaration
 */
export {
  PLUGIN_DATABASE_KINDS,
  PLUGIN_PACKAGE_DECLARATION_FORMAT,
  pluginPackageDeclarationJsonSchema,
  type PluginContentTarget,
  type PluginDatabaseKind,
  type PluginPackageInstallOption,
  type PluginPackageDeclaration,
  type PluginPackageRegistration,
} from "./format";
export {
  readPluginPackageDeclaration,
  type PluginPackageDeclarationReading,
} from "./read";
export {
  comparePluginPackageDeclaration,
  type PluginDeclarationDifference,
  type PluginDeclarationDifferenceKind,
} from "./compare";
export {
  checkPluginPackageDeclaration,
  type CheckPluginPackageDeclarationOptions,
} from "./check";
