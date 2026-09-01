import type {
  PluginAdminCustomWidget,
  PluginAdminDeclarativeWidget,
  PluginAdminWidget,
} from "nextly/config";
import { expectTypeOf } from "vitest";

import type { ReadableWidgetDeclaration } from "@admin/components/features/widgets/resolve-widgets";

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

// `component` is CONDITIONAL now: required for a widget the plugin draws,
// absent for one the host draws from an archetype and a query. Asserted as
// assignability of each tier's declaration, because a union has no single shape
// and `toMatchTypeOf` against one asks every member to match -- the old
// assertion would fail for the declarative member over a property that is
// correctly optional there.
expectTypeOf<{
  id: string;
  component: string;
}>().toMatchTypeOf<PluginWidgetMeta>();
expectTypeOf<{
  id: string;
  archetype: "metric";
  query: { source: "collection:posts"; op: "count" };
}>().toMatchTypeOf<PluginWidgetMeta>();

// The admin alias tracks core's union rather than restating it, so a widget
// describing no body is refused here for the same reason it is refused there.
expectTypeOf<{ id: string }>().not.toMatchTypeOf<PluginWidgetMeta>();

// Every field the RESOLVER reads is a field core actually declares.
//
// `ReadableWidgetDeclaration` is a structural reading contract rather than an
// alias of the authoring union — a reader wants every field optional, and
// `mergeCollision` composes two declarations into something neither arm
// describes. That independence is the point and it is also the risk: a field
// RENAMED in core would leave the resolver reading a property that no longer
// exists, compiling forever and quietly returning `undefined`. Nothing else
// would say so, because an extra optional property is assignable everywhere.
//
// Only the reader's own field names are checked. Core growing a field the
// resolver ignores is fine and expected; core losing one it reads is not.
// Distributes over the union's ARMS. `keyof (A | B)` is only what A and B have
// in COMMON, so a field declared on one arm -- `actions`, which only an
// `actions` widget carries -- reads as a key core does not declare and trips
// this guard for the wrong reason.
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

type UnreadableKeys = Exclude<
  keyof ReadableWidgetDeclaration,
  KeysOfUnion<PluginAdminCustomWidget | PluginAdminDeclarativeWidget>
>;
expectTypeOf<UnreadableKeys>().toBeNever();

// And the metadata list carries that same shape, which is what a reader of
// `branding.plugins[].widgets` actually holds.
expectTypeOf<
  NonNullable<PluginMetadata["widgets"]>[number]
>().toEqualTypeOf<PluginWidgetMeta>();
