import type { JSX } from "react";

import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";
import { useSettingsLanding } from "@admin/hooks/useSettingsLanding";

interface UserBreadcrumbsProps {
  /**
   * Current page in the user management flow
   */
  currentPage:
    | "list"
    | "create"
    | "edit"
    | "fields"
    | "fields-create"
    | "fields-edit";
}

/**
 * Page label mapping for breadcrumb display
 */
const PAGE_LABELS = {
  create: "Create User",
  edit: "Edit User",
  list: "Users",
  fields: "Fields",
  "fields-create": "Create Field",
  "fields-edit": "Edit Field",
} as const;

/**
 * UserBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for user management pages.
 * Utilizes the shared Breadcrumbs component for unified styling.
 */
export function UserBreadcrumbs({
  currentPage,
}: UserBreadcrumbsProps): JSX.Element {
  const currentLabel = PAGE_LABELS[currentPage];

  // Users lives under the Settings section, so the trail nests under a
  // "Settings" parent crumb before the "Users" item. A users-only role can't
  // open the read-settings-guarded General page, so the crumb leads to the
  // first Settings page this reader can open, as the rail's Settings entry
  // does.
  const settingsHref = useSettingsLanding();
  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
    { label: "Settings", href: settingsHref },
  ];

  if (currentPage === "list") {
    items.push({ label: "Users" });
  } else {
    items.push({ label: "Users", href: ROUTES.USERS });

    // The user fields screens are reached from the Users page, so their
    // trail runs Settings › Users › Fields; the create and edit screens add
    // their own crumb under Fields.
    if (["fields-create", "fields-edit"].includes(currentPage)) {
      items.push({ label: PAGE_LABELS.fields, href: ROUTES.USERS_FIELDS });
    }

    items.push({ label: currentLabel });
  }

  return <Breadcrumbs items={items} />;
}
