import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

interface RoleBreadcrumbsProps {
  /**
   * Current page in the role management flow
   */
  currentPage: "list" | "create" | "edit";
}

/**
 * Page label mapping for breadcrumb display
 */
const PAGE_LABELS = {
  create: "Create Role",
  edit: "Edit Role",
  list: "Roles",
} as const;

/**
 * RoleBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for role management pages.
 * Utilizes the shared Breadcrumbs component for unified styling.
 */
export function RoleBreadcrumbs({ currentPage }: RoleBreadcrumbsProps) {
  const currentLabel = PAGE_LABELS[currentPage];
  const { hasPermission } = useCurrentUserPermissions();

  // Roles live under the Settings section (User Management) now, so the trail
  // nests under a "Settings" parent crumb before the "Roles" item. A roles-only
  // user can't open the manage-settings-guarded General page, so point the crumb
  // at the first Settings subpage it can reach (Roles here).
  const settingsHref = hasPermission("manage-settings")
    ? ROUTES.SETTINGS
    : ROUTES.SECURITY_ROLES;
  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
    { label: "Settings", href: settingsHref },
  ];

  if (currentPage === "list") {
    items.push({ label: "Roles" });
  } else {
    items.push({ label: "Roles", href: ROUTES.SECURITY_ROLES });
    items.push({ label: currentLabel });
  }

  return <Breadcrumbs items={items} />;
}
