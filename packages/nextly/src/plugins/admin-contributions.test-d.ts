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

// ComponentPath is the string-path registry key (D19).
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();

// Menu item shape (D20) — no `visible(ctx)` in v1 (OQ-1); one level of children.
expectTypeOf<PluginMenuItem>().toMatchTypeOf<{
  label: string;
  to: string;
  icon?: string;
  order?: number;
  requiredPermission?: string;
  children?: PluginMenuItem[];
}>();

// Pages (D21).
expectTypeOf<
  NonNullable<PluginAdminContributions["pages"]>[number]
>().toMatchTypeOf<{
  path: string;
  component: ComponentPath;
  requiredPermission?: string;
}>();

// Settings (D21).
expectTypeOf<
  NonNullable<PluginAdminContributions["settings"]>
>().toMatchTypeOf<{ component: ComponentPath }>();

// Views (D23) — keyed by collection slug; six injection points.
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

// Widgets (D22) — RESERVED/type-only in P5 (rendering deferred to M8/D58).
expectTypeOf<
  NonNullable<PluginAdminContributions["widgets"]>[number]
>().toMatchTypeOf<{
  id: string;
  component: ComponentPath;
  size?: "full" | "half";
  requiredPermission?: string;
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
