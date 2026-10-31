import type { WidgetDefinition } from "nextly/config";
import { expectTypeOf } from "vitest";

import type {
  PluginMenuItemMeta,
  PluginMetadata,
  PluginPageMeta,
  RegisteredWidgetMeta,
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

// Widget metadata. A widget reaches the admin only through the registry, so the
// admin's view of it is DERIVED from the server's published definition rather
// than restated, and a plugin's own metadata carries none.
expectTypeOf<RegisteredWidgetMeta>().toEqualTypeOf<WidgetDefinition>();
expectTypeOf<PluginMetadata>().not.toHaveProperty("widgets");
