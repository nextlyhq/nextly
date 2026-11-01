import type { PublishedWidget } from "nextly/widget-result";
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
// admin's view of it is core's wire type for what the registry publishes each
// widget as (`PublishedWidget`) rather than a restatement, and a plugin's own
// metadata carries none.
expectTypeOf<RegisteredWidgetMeta>().toEqualTypeOf<PublishedWidget>();
// Every card is answered on the server from its declaration's `load`, so a
// published widget carries no query, cells, actions or text of its own for the
// admin to ask or draw: none of the fields that described that is published.
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("serverData");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("query");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("cells");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("actions");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("content");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("link");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("dismissible");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("sizedQuery");
expectTypeOf<RegisteredWidgetMeta>().not.toHaveProperty("sourceFilters");
expectTypeOf<PluginMetadata>().not.toHaveProperty("widgets");
