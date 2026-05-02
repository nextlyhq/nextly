import React from "react";

import { Folder as FolderIcon } from "@admin/components/icons";
import { Breadcrumbs, type BreadcrumbItem } from "@admin/components/shared";
import { useFolderContents } from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";

export interface FolderBreadcrumbsProps {
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  className?: string;
  /**
   * Whether to show the root "All Media" breadcrumb
   * @default true
   */
  showRoot?: boolean;
}

/**
 * FolderBreadcrumbs Component
 *
 * Specialized breadcrumb navigation for the Media Library folder structure.
 * Utilizes the shared Breadcrumbs component for unified styling and interactivity.
 */
export function FolderBreadcrumbs({
  activeFolderId,
  onFolderSelect,
  className,
  showRoot = true,
}: FolderBreadcrumbsProps) {
  const { data: folderContents } = useFolderContents(activeFolderId);
  const breadcrumbs = folderContents?.breadcrumbs ?? [];

  const items: BreadcrumbItem[] = [];

  if (showRoot) {
    items.push({
      label: "All Media",
      onClick: () => onFolderSelect(null),
      icon: <FolderIcon className="h-3.5 w-3.5" />,
      // We don't set isDashboard here because we want the FolderIcon,
      // but we want the same styling.
    });
  }

  breadcrumbs.forEach(crumb => {
    if (crumb.id === "root") return;
    items.push({
      label: crumb.name,
      onClick: () => onFolderSelect(crumb.id),
    });
  });

  return <Breadcrumbs items={items} className={cn("mb-0", className)} />;
}
