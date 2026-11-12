/**
 * The user fields pages are reached from the Users page, whose Fields action is
 * their only entry, so they ask what that page asks as well as their own
 * Settings grant. A role holding the Settings grant without `read-users` has
 * no way to the pages, and would otherwise be let in by address alone to edit
 * the fields of accounts it cannot see.
 *
 * The route's own guard checks the Settings grant; this one, inside it, checks
 * `read-users`, so the page opens only with both.
 */
import type { JSX, ReactNode } from "react";

import { PermissionGuard } from "@admin/components/guards/PermissionGuard";

/** The grant the Users page asks, which the user fields pages ask as well. */
const USER_FIELDS_ALSO_REQUIRE = "read-users";

export function UserFieldsGuard({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <PermissionGuard requiredPermission={USER_FIELDS_ALSO_REQUIRE}>
      {children}
    </PermissionGuard>
  );
}
