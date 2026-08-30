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

// Widgets — rendered by the dashboard grid, permission-gated. `component`
// is optional (required only for `archetype: "custom"`, enforced at
// registration rather than by the type); `size` survives as a deprecated
// alias for `defaultSize`.
expectTypeOf<
  NonNullable<PluginAdminContributions["widgets"]>[number]
>().toMatchTypeOf<{
  id: string;
  title: string;
  archetype: string;
  defaultSize: string;
  requiredPermission?: string;
  component?: ComponentPath;
  size?: "full" | "half";
}>();

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
