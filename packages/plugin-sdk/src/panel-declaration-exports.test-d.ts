/**
 * A standalone plugin's panel declarations reach a plugin through the SDK as
 * core declares them, from the package root and from `./admin` alike.
 */
import { expectTypeOf } from "vitest";

import type {
  PluginAdminContributions,
  PluginAdminPanel,
  PluginItemCount,
  PluginMenuItem,
  PluginPanelGroup,
} from "@nextlyhq/plugin-sdk";
import type {
  PluginAdminPanel as AdminEntryPanel,
  PluginItemCount as AdminEntryItemCount,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<AdminEntryPanel>().toEqualTypeOf<PluginAdminPanel>();
expectTypeOf<AdminEntryItemCount>().toEqualTypeOf<PluginItemCount>();
expectTypeOf<PluginAdminContributions["panel"]>().toEqualTypeOf<
  PluginAdminPanel | undefined
>();
expectTypeOf<PluginAdminPanel["groups"]>().toEqualTypeOf<
  ReadonlyArray<PluginPanelGroup>
>();

// Both count forms, as a count and as a badge.
expectTypeOf<{
  label: string;
  to: string;
  group: string;
  count: { collection: string };
}>().toExtend<PluginMenuItem>();
expectTypeOf<{
  label: string;
  to: string;
  badge: { attention: string };
}>().toExtend<PluginMenuItem>();
// Never both on one item.
expectTypeOf<{
  label: string;
  to: string;
  count: { collection: string };
  badge: { attention: string };
}>().not.toExtend<PluginMenuItem>();
