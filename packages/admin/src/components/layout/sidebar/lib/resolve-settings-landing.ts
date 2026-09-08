/**
 * Where the Settings rail entry sends this reader.
 *
 * The panel's table already decides two things: whether the rail entry appears
 * (`settingsPanelSlugs` feeds `canViewSettings`) and whether `/admin/settings`
 * opens at all (the same list guards the route). This is the third, and it was
 * the one still maintained by hand — a ternary chain in `DualSidebar` naming
 * seven destinations in an order of its own. A destination added to the table
 * and not to that chain is unreachable from the rail: the entry appears, the
 * link falls through every arm, and the reader lands on General Settings, whose
 * own query answers to `manage-settings` and returns 403. Background Jobs was
 * added to the table and to none of the arms, and that is exactly what a
 * jobs-only operator saw.
 *
 * Deriving it here closes the class rather than the instance: the landing is
 * the first destination in the panel, in the panel's own order, that this
 * reader can actually OPEN. "Can see" and "can open" are different questions,
 * so each item is tested against `routePermission` where it declares one and
 * against its visibility gate otherwise.
 *
 * @module components/layout/sidebar/lib/resolve-settings-landing
 */
import { ROUTES } from "@admin/constants/routes";

import {
  SETTINGS_NAV,
  isSettingsNavItemVisible,
  type SettingsNavAccess,
  type SettingsNavGroup,
  type SettingsNavItem,
} from "./settings-nav";

/**
 * Whether this reader satisfies a route's declared grant.
 *
 * Any-of over a list and a plain check over a single slug, which is what
 * `PermissionGuard` does with `requiredPermission`. A destination declaring
 * nothing extra is governed by its visibility gate alone.
 */
function mayOpen(item: SettingsNavItem, access: SettingsNavAccess): boolean {
  const required = item.routePermission;
  if (required === undefined) return true;
  return Array.isArray(required)
    ? required.some(access.hasPermission)
    : access.hasPermission(required as string);
}

/**
 * The first panel destination this reader can open, or the panel itself.
 *
 * The fallback is deliberate and unchanged: a reader who can open nothing in
 * the panel is sent to `/admin/settings`, whose route guard refuses them and
 * returns them to the dashboard. Inventing a friendlier destination here would
 * be choosing a page on behalf of someone the table says has none.
 */
export function resolveSettingsLanding(
  access: SettingsNavAccess,
  nav: readonly SettingsNavGroup[] = SETTINGS_NAV
): string {
  for (const group of nav) {
    for (const item of group.items) {
      if (!isSettingsNavItemVisible(item, access)) continue;
      if (!mayOpen(item, access)) continue;
      return item.href;
    }
  }
  return ROUTES.SETTINGS;
}
