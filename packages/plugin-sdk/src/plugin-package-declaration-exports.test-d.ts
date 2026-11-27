/**
 * A plugin package's declaration, through the SDK.
 *
 * What these pin: the check and the reader are core's own functions, not
 * copies that could drift from what `nextly plugins add` reads; the check
 * takes a parsed package.json and the plugin's definition and answers in
 * sentences; and the declaration's type is what its reader returns.
 */
import { expectTypeOf } from "vitest";

import {
  checkPluginPackageDeclaration as coreCheck,
  readPluginPackageDeclaration as coreRead,
} from "nextly";

import {
  PLUGIN_DATABASE_KINDS,
  PLUGIN_PACKAGE_DECLARATION_FORMAT,
  checkPluginPackageDeclaration,
  pluginPackageDeclarationJsonSchema,
  readPluginPackageDeclaration,
} from "@nextlyhq/plugin-sdk";
import type {
  CheckPluginPackageDeclarationOptions,
  PluginDatabaseKind,
  PluginDefinition,
  PluginPackageDeclaration,
  PluginPackageDeclarationReading,
  PluginPackageRegistration,
} from "@nextlyhq/plugin-sdk";

expectTypeOf(checkPluginPackageDeclaration).toEqualTypeOf(coreCheck);
expectTypeOf(readPluginPackageDeclaration).toEqualTypeOf(coreRead);

expectTypeOf(checkPluginPackageDeclaration)
  .parameter(0)
  .toEqualTypeOf<unknown>();
expectTypeOf(checkPluginPackageDeclaration)
  .parameter(1)
  .toEqualTypeOf<PluginDefinition>();
expectTypeOf(checkPluginPackageDeclaration)
  .parameter(2)
  .toEqualTypeOf<CheckPluginPackageDeclarationOptions | undefined>();
expectTypeOf(checkPluginPackageDeclaration).returns.toEqualTypeOf<string[]>();

// The databases a suite names are the ones a declaration can list.
expectTypeOf<PluginDatabaseKind>().toEqualTypeOf<
  "postgresql" | "mysql" | "sqlite"
>();
expectTypeOf(PLUGIN_DATABASE_KINDS).toEqualTypeOf<
  readonly ["postgresql", "mysql", "sqlite"]
>();
expectTypeOf<CheckPluginPackageDeclarationOptions["databases"]>().toEqualTypeOf<
  readonly PluginDatabaseKind[] | undefined
>();

// A read declaration is the declaration type, and format 1 is the format.
expectTypeOf<
  Extract<PluginPackageDeclarationReading, { kind: "declared" }>["declaration"]
>().toEqualTypeOf<PluginPackageDeclaration>();
expectTypeOf<PluginPackageDeclaration["format"]>().toEqualTypeOf<1>();
expectTypeOf(PLUGIN_PACKAGE_DECLARATION_FORMAT).toEqualTypeOf<1>();
expectTypeOf<PluginPackageDeclaration["core"]>().toEqualTypeOf<string>();
expectTypeOf<PluginPackageDeclaration["plugin"]>().toEqualTypeOf<
  PluginPackageRegistration | undefined
>();

expectTypeOf(pluginPackageDeclarationJsonSchema).returns.toEqualTypeOf<
  Record<string, unknown>
>();
