import { expectTypeOf } from "vitest";

import type {
  PluginMenuItemMeta,
  PluginMetadata,
  PluginPageMeta,
} from "./branding";

// Menu metadata (D20) — delivered via /admin-meta, one level of children.
expectTypeOf<PluginMetadata["menu"]>().toEqualTypeOf<
  PluginMenuItemMeta[] | undefined
>();
expectTypeOf<PluginMenuItemMeta>().toMatchTypeOf<{
  label: string;
  to: string;
  icon?: string;
  order?: number;
  requiredPermission?: string;
  children?: PluginMenuItemMeta[];
}>();

// Page metadata (D21).
expectTypeOf<
  NonNullable<PluginMetadata["pages"]>[number]
>().toMatchTypeOf<PluginPageMeta>();
expectTypeOf<PluginPageMeta>().toMatchTypeOf<{
  path: string;
  component: string;
  requiredPermission?: string;
}>();

// Settings metadata (D21).
expectTypeOf<NonNullable<PluginMetadata["settings"]>>().toMatchTypeOf<{
  component: string;
}>();
