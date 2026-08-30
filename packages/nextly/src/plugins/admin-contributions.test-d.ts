import { expectTypeOf } from "vitest";

import type {
  ComponentPath,
  PluginAdminContributions,
  PluginMenuItem,
} from "./admin-contributions";
import type { PluginContributions } from "./contributions";
import { definePlugin } from "./plugin-context";

// contributes.admin is optional and typed as PluginAdminContributions.
expectTypeOf<PluginContributions["admin"]>().toEqualTypeOf<
  PluginAdminContributions | undefined
>();

// ComponentPath is the string-path registry key.
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();

// Menu item shape — no `visible(ctx)` in v1; one level of children.
expectTypeOf<PluginMenuItem>().toMatchTypeOf<{
  label: string;
  to: string;
  icon?: string;
  order?: number;
  requiredPermission?: string;
  children?: PluginMenuItem[];
}>();

// Pages.
expectTypeOf<
  NonNullable<PluginAdminContributions["pages"]>[number]
>().toMatchTypeOf<{
  path: string;
  component: ComponentPath;
  requiredPermission?: string;
}>();

// Settings.
expectTypeOf<
  NonNullable<PluginAdminContributions["settings"]>
>().toMatchTypeOf<{ component: ComponentPath }>();

// Views — keyed by collection slug; six injection points.
expectTypeOf<
  NonNullable<PluginAdminContributions["views"]>[string]
>().toMatchTypeOf<{
  list?: ComponentPath;
  edit?: ComponentPath;
  beforeList?: ComponentPath;
  afterList?: ComponentPath;
  beforeEdit?: ComponentPath;
  afterEdit?: ComponentPath;
}>();

// Widgets — rendered by the dashboard grid, permission-gated. `component` is
// REQUIRED and `size` is what the grid reads; the declarative fields are
// optional additions nothing renders from yet.
expectTypeOf<
  NonNullable<PluginAdminContributions["widgets"]>[number]
>().toMatchTypeOf<{
  id: string;
  component: ComponentPath;
  size?: "full" | "half";
  requiredPermission?: string;
  title?: string;
  archetype?: string;
  defaultSize?: string;
}>();

// `component` is REQUIRED, asserted on its own. A widget without one reaches
// `PluginSlot` with `path === undefined` and renders an empty cell silently,
// so the type is the only thing standing between a plugin author and a card
// that draws nothing. `toMatchTypeOf` against a REQUIRED `component` is an
// evaluated assertion: were it optional, the match would fail.
expectTypeOf<
  NonNullable<PluginAdminContributions["widgets"]>[number]
>().toMatchTypeOf<{ component: ComponentPath }>();

// The declarative half must stay OPTIONAL while nothing renders from it, or
// every existing `{ id, component, size }` declaration stops compiling. Read
// through `Partial`, which a required property would refuse to satisfy.
expectTypeOf<{
  id: string;
  component: ComponentPath;
  size: "half";
}>().toMatchTypeOf<NonNullable<PluginAdminContributions["widgets"]>[number]>();

// A plugin can declare contributes.admin via definePlugin.
definePlugin({
  name: "@acme/x",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    admin: {
      menu: [
        {
          label: "Forms",
          to: "/admin/collections/forms",
          icon: "file-text",
          order: 10,
          requiredPermission: "read-forms",
          children: [{ label: "All", to: "/admin/collections/forms" }],
        },
      ],
      pages: [
        {
          path: "reports",
          component: "@acme/x/admin#Reports",
          requiredPermission: "read-reports",
        },
      ],
      settings: { component: "@acme/x/admin#Settings" },
      views: {
        forms: {
          edit: "@acme/x/admin#FormEdit",
          beforeList: "@acme/x/admin#Banner",
        },
      },
    } satisfies PluginAdminContributions,
  },
});

// admin.styles declares precompiled plugin CSS; accepts one path or several.
expectTypeOf<PluginAdminContributions["styles"]>().toEqualTypeOf<
  string | string[] | undefined
>();
