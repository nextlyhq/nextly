import { expectTypeOf } from "vitest";

import type { PluginAdminContributions as RootAdminContributions } from "@nextlyhq/plugin-sdk";
import {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  ComponentPath,
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  PluginMenuItem,
} from "@nextlyhq/plugin-sdk/admin";

// The root entry also re-exports the contract types (node-safe, no React).

// Registration runtime is exposed for plugin admin modules.
expectTypeOf(registerComponent).toBeFunction();
expectTypeOf(registerComponents).toBeFunction();
expectTypeOf(registerKnownPlugin).toBeFunction();

// Contract types are re-exported on the admin entry.
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();
expectTypeOf<PluginAdminContributions>().toMatchTypeOf<{
  menu?: PluginMenuItem[];
  pages?: PluginAdminPage[];
}>();
expectTypeOf<PluginCollectionView>().toMatchTypeOf<{
  edit?: ComponentPath;
  list?: ComponentPath;
}>();
expectTypeOf<RootAdminContributions>().toEqualTypeOf<PluginAdminContributions>();
