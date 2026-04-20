import { ChevronRight, Home } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface UserBreadcrumbsProps {
  /**
   * Current page in the user management flow
   * - "list": Users list page
   * - "create": Create user page
   * - "edit": Edit user page
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
 * Shows the navigation path: Dashboard → Users → [Current Page]
 *
 * @example
 * ```tsx
 * <UserBreadcrumbs currentPage="create" />
 * <UserBreadcrumbs currentPage="edit" />
 * ```
 */
export function UserBreadcrumbs({ currentPage }: UserBreadcrumbsProps) {
  const currentLabel = PAGE_LABELS[currentPage];

  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex items-center gap-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Link
            href={ROUTES.DASHBOARD}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Home className="h-4 w-4" />
            <span>Dashboard</span>
          </Link>
          <ChevronRight className="h-4 w-4" />
        </li>

        {currentPage !== "list" && (
          <>
            <li className="flex items-center gap-2">
              <Link
                href={ROUTES.USERS}
                className="hover:text-foreground transition-colors"
              >
                Users
              </Link>
              <ChevronRight className="h-4 w-4" />
            </li>
            {["fields-create", "fields-edit"].includes(currentPage) ? (
              <>
                <li className="flex items-center gap-2">
                  <Link
                    href={ROUTES.USERS_FIELDS}
                    className="hover:text-foreground transition-colors"
                  >
                    User Fields
                  </Link>
                  <ChevronRight className="h-4 w-4" />
                </li>
                <li className="text-foreground font-medium">{currentLabel}</li>
              </>
            ) : (
              <li className="text-foreground font-medium">{currentLabel}</li>
            )}
          </>
        )}

        {currentPage === "list" && (
          <li className="text-foreground font-medium">Users</li>
        )}
      </ol>
    </nav>
  );
}
