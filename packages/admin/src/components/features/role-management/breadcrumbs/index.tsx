import { ChevronRight, Home } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface RoleBreadcrumbsProps {
  /**
   * Current page in the role management flow
   * - "list": Roles list page
   * - "create": Create role page
   * - "edit": Edit role page
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
} satisfies Record<RoleBreadcrumbsProps["currentPage"], string>;

/**
 * RoleBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for role management pages.
 * Shows the navigation path: Dashboard → Roles → [Current Page]
 *
 * Features:
 * - Accessible navigation (aria-label, semantic HTML)
 * - Hover states for links
 * - Chevron separators
 * - Home icon for dashboard link
 * - Conditional rendering (list vs create/edit paths)
 *
 * @example
 * ```tsx
 * <RoleBreadcrumbs currentPage="create" />
 * <RoleBreadcrumbs currentPage="edit" />
 * ```
 */
export function RoleBreadcrumbs({ currentPage }: RoleBreadcrumbsProps) {
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
                href={ROUTES.SECURITY_ROLES}
                className="hover:text-foreground transition-colors"
              >
                Roles
              </Link>
              <ChevronRight className="h-4 w-4" />
            </li>
            <li className="text-foreground font-medium">{currentLabel}</li>
          </>
        )}

        {currentPage === "list" && (
          <li className="text-foreground font-medium">Roles</li>
        )}
      </ol>
    </nav>
  );
}
