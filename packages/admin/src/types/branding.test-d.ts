import type { PluginAdminWidget } from "nextly/config";
import { expectTypeOf } from "vitest";

import type {
  PluginMenuItemMeta,
  PluginMetadata,
  PluginPageMeta,
  PluginWidgetMeta,
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

// Widget metadata. `buildPluginAdminMeta` copies a contributed widget verbatim
// into the payload, so the admin's view of it is DERIVED from the server's
// declaration rather than restated -- which is what this pins. An interface
// re-declared here would satisfy the property assertions below and fail this
// one, which is the divergence the alias exists to make impossible.
expectTypeOf<PluginWidgetMeta>().toEqualTypeOf<PluginAdminWidget>();

// The fields the server actually serializes. Asserted as a `Pick`, which is one
// evaluated claim about the whole set rather than five about one field each: a
// name absent from the declaration cannot be picked, so a stale four-field copy
// fails here, and the value types are compared at the same time.
expectTypeOf<
  Pick<PluginWidgetMeta, "title" | "description" | "icon" | "category" | "link">
>().toEqualTypeOf<{
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  link?: { label: string; href: string };
}>();

// `component` stays REQUIRED. A widget without one reaches `PluginSlot` with
// `path === undefined` and draws an empty cell, so this is the property the
// two declarations drifted on first.
expectTypeOf<PluginWidgetMeta>().toMatchTypeOf<{ component: string }>();
expectTypeOf<{ id: string; component: string }>().toMatchTypeOf<
  Pick<PluginWidgetMeta, "id" | "component">
>();

// And the metadata list carries that same shape, which is what a reader of
// `branding.plugins[].widgets` actually holds.
expectTypeOf<
  NonNullable<PluginMetadata["widgets"]>[number]
>().toEqualTypeOf<PluginWidgetMeta>();
