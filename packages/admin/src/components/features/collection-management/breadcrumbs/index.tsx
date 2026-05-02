import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";

interface CollectionBreadcrumbsProps {
  /**
   * Current page in the collection management flow
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
} as const;

/**
 * CollectionBreadcrumbs Component
 *
 * Consistent breadcrumb navigation for collection management pages.
 * Utilizes the shared Breadcrumbs component for unified styling.
 */
export function CollectionBreadcrumbs({
  currentPage,
  collectionName,
}: CollectionBreadcrumbsProps) {
  const currentLabel =
    currentPage === "edit" && collectionName
      ? collectionName
      : PAGE_LABELS[currentPage];

  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
  ];

  if (currentPage === "list") {
    items.push({ label: "Collections" });
  } else {
    items.push({ label: "Collections", href: ROUTES.COLLECTIONS });
    items.push({ label: currentLabel });
  }

  return <Breadcrumbs items={items} />;
}
