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

// Widgets — drawn one of TWO ways, and the union is what says so.
//
// Assertions here are ASSIGNABILITY of a declaration to the contract, not the
// shape of the contract. A union has no single shape, and `toMatchTypeOf`
// against one asks every member to match — which is how the old
// "`component` is required" assertion read, and it would now fail for the
// declarative member for a reason that has nothing to do with the property
// being tested.
type ContributedWidget = NonNullable<
  PluginAdminContributions["widgets"]
>[number];

// Tier 2: a plugin ships a component and draws its own card. Every existing
// `{ id, component, size }` declaration must keep compiling untouched — this is
// the back-compatibility assertion, and the union exists to widen rather than
// to constrain.
expectTypeOf<{
  id: string;
  component: ComponentPath;
  size: "half";
}>().toMatchTypeOf<ContributedWidget>();

// Tier 1: the host draws the card from an archetype and a query, and the
// plugin ships NO component. This is the assertion the change exists for: it
// did not compile before, so the tier the whole widget query contract was built
// for could not be declared through the contributions channel at all.
expectTypeOf<{
  id: string;
  title: string;
  archetype: "metric";
  defaultSize: "sm";
  query: { source: "collection:posts"; op: "count" };
}>().toMatchTypeOf<ContributedWidget>();

// A component MAY accompany a data archetype, as the fallback body for an
// archetype this admin release cannot draw yet. `WidgetDefinition` forbids the
// pairing on the registry side; this contract allows it deliberately, because a
// contribution crosses a version boundary and a registration does not.
expectTypeOf<{
  id: string;
  archetype: "list";
  query: { source: "collection:posts"; op: "list" };
  component: ComponentPath;
}>().toMatchTypeOf<ContributedWidget>();

// A widget describing NO body is refused by the type, which is the property an
// interface of all-optional fields could not express: `{ id }` satisfied it and
// left the boot check as the only thing that ever said so.
expectTypeOf<{ id: string }>().not.toMatchTypeOf<ContributedWidget>();

// A DATA archetype with no query describes a card core can never fill — no
// request is made for it and no slot ever arrives.
expectTypeOf<{
  id: string;
  archetype: "metric";
}>().not.toMatchTypeOf<ContributedWidget>();

// A QUERYLESS archetype is declarable with no query, because core draws `text`
// and `actions` without asking for data. Spelling the declarative arm as
// `Exclude<WidgetArchetype, "custom">` made these two undeclarable and
// contradicted the registry validator, which REFUSES a query on them.
expectTypeOf<{
  id: string;
  title: string;
  archetype: "text";
}>().toMatchTypeOf<ContributedWidget>();

// And a query on one is refused where it is written, rather than at boot.
expectTypeOf<{
  id: string;
  archetype: "actions";
  query: { source: "collection:posts"; op: "count" };
}>().not.toMatchTypeOf<ContributedWidget>();

// `custom` is the one archetype that cannot be host-drawn, so it still requires
// the component even when a query accompanies it.
expectTypeOf<{
  id: string;
  archetype: "custom";
  query: { source: "collection:posts"; op: "count" };
}>().not.toMatchTypeOf<ContributedWidget>();

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
