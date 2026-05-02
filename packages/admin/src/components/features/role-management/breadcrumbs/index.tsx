import React from "react";

import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";

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

  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
  ];

  if (currentPage === "list") {
    items.push({ label: "Roles" });
  } else {
    items.push({ label: "Roles", href: ROUTES.SECURITY_ROLES });
    items.push({ label: currentLabel });
  }

  return <Breadcrumbs items={items} />;
}
