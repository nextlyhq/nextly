import { ChevronRight, Home } from "lucide-react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface CollectionBreadcrumbsProps {
  /**
   * Current page in the collection management flow
   * - "list": Collections list page
   * - "create": Create collection page
   * - "edit": Edit collection page
   */
  currentPage: "list" | "create" | "edit";
  /**
   * Optional collection name to display in breadcrumb (for edit page)
   */
  collectionName?: string;
}

/**
 * Page label mapping for breadcrumb display
 */
const PAGE_LABELS = {
  create: "Create Collection",
  edit: "Edit Collection",
  list: "Collections",
} satisfies Record<CollectionBreadcrumbsProps["currentPage"], string>;

/**
 * CollectionBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for collection management pages.
 * Shows the navigation path: Dashboard → Collections → [Current Page]
 *
 * Features:
 * - Accessible navigation (aria-label, semantic HTML)
 * - Hover states for links
 * - Chevron separators
 * - Home icon for dashboard link
 * - Conditional rendering (list vs create/edit paths)
 * - Optional collection name display for edit page
 *
 * @example
 * ```tsx
 * <CollectionBreadcrumbs currentPage="list" />
 * <CollectionBreadcrumbs currentPage="create" />
 * <CollectionBreadcrumbs currentPage="edit" collectionName="Blog Posts" />
 * ```
 */
export function CollectionBreadcrumbs({
  currentPage,
  collectionName,
}: CollectionBreadcrumbsProps) {
  const currentLabel =
    currentPage === "edit" && collectionName
      ? collectionName
      : PAGE_LABELS[currentPage];

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
                href={ROUTES.COLLECTIONS}
                className="hover:text-foreground transition-colors"
              >
                Collections
              </Link>
              <ChevronRight className="h-4 w-4" />
            </li>
            <li className="text-foreground font-medium">{currentLabel}</li>
          </>
        )}

        {currentPage === "list" && (
          <li className="text-foreground font-medium">Collections</li>
        )}
      </ol>
    </nav>
  );
}
