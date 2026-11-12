/**
 * Where a plugin's own item goes: the bar's right end (the default), the
 * rail's foot, or the person's menu. The bar and the rail's foot take a
 * component; the menu takes a declared item and never a component, because a
 * closed menu's contents are not mounted. The config shapes plugins already
 * use keep compiling and keep meaning the bar.
 */
import { expectTypeOf } from "vitest";

import type {
  PluginAdminContributions,
  PluginHeaderContributions,
  PluginItemPlace,
  PluginUserMenuItem,
} from "./admin-contributions";

expectTypeOf<PluginItemPlace>().toEqualTypeOf<"bar" | "rail-foot" | "menu">();

// Today's spellings still compile.
const legacy = {
  headerSlot: "@acme/x/admin#Badge",
} satisfies PluginAdminContributions;
const current = {
  header: { slot: "@acme/x/admin#Badge", hideDefaults: true, hide: ["docs"] },
} satisfies PluginAdminContributions;
const hideOnly = {
  header: { hide: ["github"] },
} satisfies PluginAdminContributions;
void [legacy, current, hideOnly];

// The default and the rail's foot take a slot.
const bar = {
  slot: "@acme/x/admin#Badge",
  place: "bar",
} satisfies PluginHeaderContributions;
const railFoot = {
  slot: "@acme/x/admin#Helper",
  place: "rail-foot",
  hide: ["notifications"],
} satisfies PluginHeaderContributions;
void [bar, railFoot];

// The menu takes a declared item: a link, or an action.
const menuLink = {
  place: "menu",
  item: { label: "Support", icon: "LifeBuoy", to: "/admin/plugins/acme-x" },
  hideDefaults: true,
} satisfies PluginHeaderContributions;
const menuOpen = {
  place: "menu",
  item: {
    label: "Report",
    icon: "BookOpen",
    action: { open: "@acme/x/admin#ReportDialog" },
  },
} satisfies PluginHeaderContributions;
const menuRun = {
  place: "menu",
  item: {
    label: "Sync",
    icon: "RefreshCw",
    action: { run: { method: "POST", path: "/sync" } },
  },
} satisfies PluginHeaderContributions;
void [menuLink, menuOpen, menuRun];

// The menu never takes a component.
// @ts-expect-error -- the menu takes a declared item, not a component.
const menuSlot: PluginHeaderContributions = {
  place: "menu",
  slot: "@acme/x/admin#Badge",
  item: { label: "Support", icon: "LifeBuoy", to: "/x" },
};
// @ts-expect-error -- the menu needs its declared item.
const menuWithoutItem: PluginHeaderContributions = { place: "menu" };
// @ts-expect-error -- an item belongs to the menu, not the bar.
const barItem: PluginHeaderContributions = {
  place: "bar",
  item: { label: "Support", icon: "LifeBuoy", to: "/x" },
};
void [menuSlot, menuWithoutItem, barItem];

// A menu item is a link or an action, not both, not neither.
// @ts-expect-error -- a link and an action together.
const both: PluginUserMenuItem = {
  label: "X",
  icon: "BookOpen",
  to: "/x",
  action: { open: "@acme/x/admin#X" },
};
// @ts-expect-error -- neither a link nor an action.
const neither: PluginUserMenuItem = { label: "X", icon: "BookOpen" };
// @ts-expect-error -- an item names its icon.
const noIcon: PluginUserMenuItem = { label: "X", to: "/x" };
void [both, neither, noIcon];
