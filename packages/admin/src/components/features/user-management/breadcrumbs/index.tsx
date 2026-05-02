import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";

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
  fields: "User Fields",
  "fields-create": "Create Field",
  "fields-edit": "Edit Field",
} as const;

/**
 * UserBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for user management pages.
 * Utilizes the shared Breadcrumbs component for unified styling.
 */
export function UserBreadcrumbs({ currentPage }: UserBreadcrumbsProps) {
  const currentLabel = PAGE_LABELS[currentPage];

  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
  ];

  if (currentPage === "list") {
    items.push({ label: "Users" });
  } else {
    items.push({ label: "Users", href: ROUTES.USERS });

    if (["fields-create", "fields-edit"].includes(currentPage)) {
      items.push({ label: "User Fields", href: ROUTES.USERS_FIELDS });
    } else if (currentPage === "fields") {
      // fields is already covered by the label mapping if it was the last item
      // but here it's treated as a leaf if it's the current page
    }

    items.push({ label: currentLabel });
  }

  return <Breadcrumbs items={items} />;
}
