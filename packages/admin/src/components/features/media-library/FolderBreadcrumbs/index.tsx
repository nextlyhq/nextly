import { ChevronRight, Folder as FolderIcon } from "@admin/components/icons";
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

export function FolderBreadcrumbs({
  activeFolderId,
  onFolderSelect,
  className,
  showRoot = true,
}: FolderBreadcrumbsProps) {
  const { data: folderContents } = useFolderContents(activeFolderId);

  const breadcrumbs = folderContents?.breadcrumbs ?? [];

  return (
    <nav
      aria-label="Folder breadcrumbs"
      className={cn("flex items-center", className)}
    >
      <ol className="flex items-center gap-1 text-sm">
        {showRoot && (
          <li>
            <button
              type="button"
              onClick={() => onFolderSelect(null)}
              className={cn(
                "flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors hover-unified",
                !activeFolderId && "font-bold text-foreground",
                activeFolderId && "text-muted-foreground"
              )}
            >
              <FolderIcon className="h-3.5 w-3.5" />
              <span>All Media</span>
            </button>
          </li>
        )}

        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          const isRoot = crumb.id === "root";
          if (isRoot) return null;

          return (
            <li key={crumb.id} className="flex items-center gap-1">
              {(index > 0 || showRoot) && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              {isLast ? (
                <span className="rounded-sm px-1.5 py-0.5 font-medium text-foreground">
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onFolderSelect(crumb.id)}
                  className="rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover-unified"
                >
                  {crumb.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
