"use client";

/**
 * MediaLibrary Component
 *
 * Complete media management interface with upload, browse, search, edit, and delete functionality.
 * Integrates MediaGrid, MediaUploadDropzone, Pagination, and search/filter controls.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  List,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
  Columns,
} from "@admin/components/icons";
import { Breadcrumbs, Pagination } from "@admin/components/shared";
import { SearchBar } from "@admin/components/shared/search-bar";
import { ROUTES } from "@admin/constants/routes";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import {
  useMedia,
  useDeleteMedia,
  useBulkDeleteMedia,
  useUpdateMedia,
  useFolderContents,
  useSubfolders,
  useRootFolders,
} from "@admin/hooks/queries/useMedia";
import {
  usePersistedState,
  usePersistedStringSet,
} from "@admin/hooks/usePersistedState";
import { cn } from "@admin/lib/utils";
import type {
  Media,
  MediaParams,
  MediaType,
  MediaUpdateInput,
} from "@admin/types/media";

import { CreateFolderDialog } from "./CreateFolderDialog";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { EditFolderDialog } from "./EditFolderDialog";
import { FolderBreadcrumbs } from "./FolderBreadcrumbs";
import { FolderCardsRow } from "./FolderCardsRow";
import { MediaBulkActionBar } from "./MediaBulkActionBar";
import { MediaDeleteDialog } from "./MediaDeleteDialog";
import { MediaEditDialog } from "./MediaEditDialog";
import { MediaGrid } from "./MediaGrid";
import { MediaListView } from "./MediaListView";
import { MediaUploadDropzone } from "./MediaUploadDropzone";
import { MoveToFolderDialog } from "./MoveToFolderDialog";

/**
 * MediaLibrary component props
 */
export interface MediaLibraryProps {
  /**
   * Default page size for pagination
   * @default 24
   */
  defaultPageSize?: number;

  /**
   * Default sort field
   * @default "uploadedAt"
   */
  defaultSortBy?: "filename" | "uploadedAt" | "size";

  /**
   * Default sort order
   * @default "desc"
   */
  defaultSortOrder?: "asc" | "desc";

  /**
   * Allowed media types (restricts filter options)
   * @default undefined (all types allowed)
   */
  allowedTypes?: MediaType[];

  /**
   * Custom CSS class
   */
  className?: string;
}

const isViewMode = (value: string): value is "grid" | "list" =>
  value === "grid" || value === "list";

/**
 * MediaLibrary component
 *
 * Complete media management interface.
 */
export function MediaLibrary({
  defaultPageSize = 24,
  defaultSortBy = "uploadedAt",
  defaultSortOrder = "desc",
  allowedTypes,
  className,
}: MediaLibraryProps = {}) {
  // State: Pagination
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(defaultPageSize);
  // Hidden list-view columns persist across visits. Functional updates so
  // two quick toggles both land instead of the second reading stale state.
  const [hiddenColumns, updateHiddenColumns] = usePersistedStringSet(
    "nextly:admin:media:hidden-columns"
  );

  const toggleColumn = (key: string) => {
    updateHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // State: Filters
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<MediaType | "all">("all");
  const [sortBy, setSortBy] = React.useState<
    "filename" | "uploadedAt" | "size"
  >(defaultSortBy);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">(
    defaultSortOrder
  );

  // State: UI. List view is the default (admins scan tables faster than
  // grids); the choice persists per browser.
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">(
    "nextly:admin:media:view-mode",
    "list",
    isViewMode
  );
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isUploadCollapsed, setIsUploadCollapsed] = React.useState(true);
  const [editingMedia, setEditingMedia] = React.useState<Media | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

  // State: Single-item delete dialog
  const [mediaToDelete, setMediaToDelete] = React.useState<Media | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);

  // State: Bulk delete dialog
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] =
    React.useState(false);

  const {
    activeFolderId,
    setActiveFolderId,
    isFolderTreeVisible,
    setIsFolderTreeVisible,
    pendingAction,
    triggerAction,
  } = useMediaContext();

  // Reset page when folder changes
  React.useEffect(() => {
    setPage(0);
  }, [activeFolderId]);

  const [isCreateFolderDialogOpen, setIsCreateFolderDialogOpen] =
    React.useState(false);
  const [createFolderParentId, setCreateFolderParentId] = React.useState<
    string | undefined
  >();
  const [isMoveToFolderDialogOpen, setIsMoveToFolderDialogOpen] =
    React.useState(false);
  const [isEditFolderDialogOpen, setIsEditFolderDialogOpen] =
    React.useState(false);
  const [editFolderId, setEditFolderId] = React.useState<string | null>(null);
  const [isDeleteFolderDialogOpen, setIsDeleteFolderDialogOpen] =
    React.useState(false);
  const [deleteFolderId, setDeleteFolderId] = React.useState<string | null>(
    null
  );
  const [deleteFolderName, setDeleteFolderName] = React.useState<string>("");

  // Handle actions from global sidebar
  React.useEffect(() => {
    if (!pendingAction) return;

    if (pendingAction.type === "CREATE_FOLDER") {
      setCreateFolderParentId(pendingAction.parentId);
      setIsCreateFolderDialogOpen(true);
    } else if (pendingAction.type === "EDIT_FOLDER") {
      setEditFolderId(pendingAction.folderId);
      setIsEditFolderDialogOpen(true);
    } else if (pendingAction.type === "DELETE_FOLDER") {
      setDeleteFolderId(pendingAction.folderId);
      setDeleteFolderName(pendingAction.folderName);
      setIsDeleteFolderDialogOpen(true);
    }

    triggerAction(null);
  }, [pendingAction, triggerAction]);

  const { data: activeFolderContents } = useFolderContents(activeFolderId);
  const activeFolderName = activeFolderContents?.folder?.name ?? null;

  // Fetch child folders: subfolders when inside a folder, root folders when at root
  const { data: childSubfolders } = useSubfolders(activeFolderId ?? undefined);
  const { data: rootFoldersList } = useRootFolders();

  const foldersToDisplay = activeFolderId ? childSubfolders : rootFoldersList;
  const hasFoldersToDisplay = foldersToDisplay && foldersToDisplay.length > 0;

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0); // Reset to page 1 when search changes
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Build query params. Local React state name `pageSize` (admin-
  // internal) maps to canonical wire field `limit`.
  const queryParams: MediaParams = {
    page: page + 1,
    limit: pageSize,
    search: debouncedSearch || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    folderId: activeFolderId,
    sortBy,
    sortOrder,
  };

  // TanStack Query: Fetch media
  const { data, isLoading, isFetching, error, refetch } = useMedia(queryParams);

  // TanStack Query: Delete single item
  const { mutate: deleteMedia, isPending: isDeleting } = useDeleteMedia();

  // TanStack Query: Bulk delete
  const { mutate: bulkDeleteMedia, isPending: isBulkDeleting } =
    useBulkDeleteMedia();

  // TanStack Query: Update media
  const { mutate: updateMedia, isPending: isUpdating } = useUpdateMedia();

  // Handlers: Selection
  const handleSelectionChange = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = React.useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Handlers: Upload
  const handleUploadComplete = React.useCallback(
    (_media: Media[]) => {
      // Refetch to show new uploads
      void refetch();
      // Clear selection
      setSelectedIds(new Set());
    },
    [refetch]
  );

  // Collapse the drop target as soon as files start uploading; the dropzone's
  // queue keeps rendering while collapsed, so progress stays visible.
  const handleUploadStart = React.useCallback(() => {
    setIsUploadCollapsed(true);
  }, []);

  // Handlers: Delete
  const handleDeleteItem = React.useCallback((media: Media) => {
    setMediaToDelete(media);
    setIsDeleteDialogOpen(true);
  }, []);

  const handleConfirmDeleteItem = React.useCallback(async () => {
    if (!mediaToDelete) return;
    await new Promise<void>((resolve, reject) => {
      deleteMedia(mediaToDelete.id, {
        onSuccess: () => {
          setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(mediaToDelete.id);
            return next;
          });
          resolve();
        },
        onError: error => {
          reject(error);
        },
      });
    });
  }, [deleteMedia, mediaToDelete]);

  const handleBulkDelete = React.useCallback(() => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleteDialogOpen(true);
  }, [selectedIds]);

  const handleConfirmBulkDelete = React.useCallback(() => {
    // `bulkDeleteMedia` wraps `useMutation`, so the call signature is
    // `mutate(variables, options)`. The hook itself shows a server-
    // authored toast (e.g. "Deleted 4 of 5 files."); we just close
    // the dialog + clear selection on either success or error.
    const idsArray = Array.from(selectedIds);
    bulkDeleteMedia(idsArray, {
      onSuccess: () => {
        setSelectedIds(new Set());
        setIsBulkDeleteDialogOpen(false);
      },
      onError: () => {
        setIsBulkDeleteDialogOpen(false);
      },
    });
  }, [selectedIds, bulkDeleteMedia]);

  // Handlers: Edit
  const handleEditMedia = React.useCallback((media: Media) => {
    setEditingMedia(media);
    setIsEditDialogOpen(true);
  }, []);

  const handleSaveMedia = React.useCallback(
    async (updates: MediaUpdateInput) => {
      if (!editingMedia) return;

      return new Promise<void>((resolve, reject) => {
        updateMedia(
          { mediaId: editingMedia.id, updates },
          {
            onSuccess: () => {
              console.log("[MediaLibrary] Updated:", editingMedia.id);
              resolve();
            },
            onError: error => {
              console.error("[MediaLibrary] Update error:", error);
              reject(error);
            },
          }
        );
      });
    },
    [editingMedia, updateMedia]
  );

  // Handlers: Pagination
  const handlePageChange = React.useCallback((newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handlePageSizeChange = React.useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0); // Reset to page 1 when page size changes
  }, []);

  // Handlers: Filters
  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value);
  }, []);

  const handleTypeFilterChange = React.useCallback((value: string) => {
    setTypeFilter(value as MediaType | "all");
    setPage(0); // Reset to page 1 when filter changes
  }, []);

  const handleSortChange = React.useCallback((value: string) => {
    // Narrow the "<field>-<order>" select value by comparison; the option
    // list is closed, so anything else is ignored rather than cast through.
    const [newSortBy, newSortOrder] = value.split("-");
    if (
      (newSortBy === "uploadedAt" ||
        newSortBy === "filename" ||
        newSortBy === "size") &&
      (newSortOrder === "asc" || newSortOrder === "desc")
    ) {
      setSortBy(newSortBy);
      setSortOrder(newSortOrder);
      setPage(0); // Reset to page 1 when ordering changes
    }
  }, []);

  // Handlers: Folders

  const handleDeleteFolderSuccess = React.useCallback(() => {
    if (deleteFolderId === activeFolderId) {
      setActiveFolderId(null);
      setPage(0);
    }
  }, [deleteFolderId, activeFolderId, setActiveFolderId]);

  const handleMoveToFolder = React.useCallback(() => {
    if (selectedIds.size === 0) return;
    setIsMoveToFolderDialogOpen(true);
  }, [selectedIds]);

  const handleDownload = React.useCallback(async (media: Media) => {
    if (!media.url) return;
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = media.originalFilename || media.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(media.url, "_blank");
    }
  }, []);

  const handleToggleAll = React.useCallback(
    (selected: boolean) => {
      if (selected) {
        const allIdsOnPage = data?.data.map(m => m.id) || [];
        setSelectedIds(prev => {
          const next = new Set(prev);
          allIdsOnPage.forEach(id => next.add(id));
          return next;
        });
      } else {
        const allIdsOnPage = data?.data.map(m => m.id) || [];
        setSelectedIds(prev => {
          const next = new Set(prev);
          allIdsOnPage.forEach(id => next.delete(id));
          return next;
        });
      }
    },
    [data?.data]
  );
  const totalPages =
    data?.meta?.totalPages || (data?.data && data.data.length > 0 ? 1 : 0);
  const total = data?.meta?.total || 0;
  // const hasSelection = selectedIds.size > 0;

  return (
    <div className={cn("flex min-h-[calc(100vh-4rem)]", className)}>
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Page Breadcrumb (Move above the title) */}
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Media Library" },
          ]}
          className="mb-6"
        />
        {/* Header Section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Media Library
            </h1>
            <p className="text-sm font-normal text-muted-foreground mt-1">
              {/* Muted foreground so this secondary file count meets contrast; a faint primary alpha did not. */}
              {total} {total === 1 ? "file" : "files"}
              {activeFolderId && " in this folder"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Folder tree toggle: one button that shows/hides the tree
                sub-sidebar. Inline folder navigation stays on the page either
                way, so this never changes where folders live. */}
            <div className="flex items-center bg-background border border-border rounded-none p-1 shrink-0 transition-all duration-200">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-none transition-all duration-200 cursor-pointer!",
                  isFolderTreeVisible
                    ? "bg-primary/5 text-primary shadow-none hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
                )}
                onClick={() => setIsFolderTreeVisible(!isFolderTreeVisible)}
                aria-pressed={isFolderTreeVisible}
                title={
                  isFolderTreeVisible ? "Hide folder tree" : "Show folder tree"
                }
              >
                {isFolderTreeVisible ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </Button>
            </div>
            {/* View Toggle Group (Gallery) */}
            <div className="flex items-center bg-background border border-border rounded-none p-1 shrink-0 transition-all duration-200">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-none transition-all duration-200 !cursor-pointer",
                  viewMode === "grid"
                    ? "bg-primary/5 text-primary shadow-none hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
                )}
                onClick={() => setViewMode("grid")}
                title="Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-none transition-all duration-200 !cursor-pointer",
                  viewMode === "list"
                    ? "bg-primary/5 text-primary shadow-none hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
                )}
                onClick={() => setViewMode("list")}
                title="List View"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            {/* Upload Button */}
            <Button
              onClick={() => setIsUploadCollapsed(!isUploadCollapsed)}
              className={cn(
                "flex items-center gap-2 px-5 h-10 shrink-0 font-medium tracking-tight rounded-none",
                !isUploadCollapsed ? "opacity-90" : ""
              )}
            >
              <Upload className="h-4 w-4" />
              <span>Upload Files</span>
            </Button>
          </div>
        </div>

        {/* Upload Dropzone (Now below folder view) */}

        <MediaUploadDropzone
          isCollapsed={isUploadCollapsed}
          onToggleCollapse={() => setIsUploadCollapsed(!isUploadCollapsed)}
          onUploadComplete={handleUploadComplete}
          onUploadStart={handleUploadStart}
          activeFolderId={activeFolderId}
          activeFolderName={activeFolderName}
          className={cn(!isUploadCollapsed && "mb-8")}
        />

        {/* Toolbar: Search + Filters */}
        <div
          className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6"
          suppressHydrationWarning
        >
          <div className="relative flex-1">
            <SearchBar
              value={search}
              onChange={handleSearchChange}
              placeholder="Search media files by name or alt text..."
              isLoading={isFetching}
              className="max-w-md"
            />
          </div>

          {/* Type Filter */}
          <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
            <SelectTrigger className="w-full sm:w-[180px] hover-unified bg-background text-foreground border-border hover:bg-accent/10">
              <SelectValue placeholder="Type: All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {(!allowedTypes || allowedTypes.includes("image")) && (
                <SelectItem value="image">Images</SelectItem>
              )}
              {(!allowedTypes || allowedTypes.includes("video")) && (
                <SelectItem value="video">Videos</SelectItem>
              )}
              {(!allowedTypes || allowedTypes.includes("document")) && (
                <SelectItem value="document">Documents</SelectItem>
              )}
              {(!allowedTypes || allowedTypes.includes("audio")) && (
                <SelectItem value="audio">Audio</SelectItem>
              )}
              {(!allowedTypes || allowedTypes.includes("other")) && (
                <SelectItem value="other">Other</SelectItem>
              )}
            </SelectContent>
          </Select>

          {/* Sort (same vocabulary as the media picker) */}
          <Select
            value={`${sortBy}-${sortOrder}`}
            onValueChange={handleSortChange}
          >
            <SelectTrigger className="w-full sm:w-[180px] shrink-0 hover-unified bg-background text-foreground border-border hover:bg-accent/10">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uploadedAt-desc">Newest First</SelectItem>
              <SelectItem value="uploadedAt-asc">Oldest First</SelectItem>
              <SelectItem value="filename-asc">Name A-Z</SelectItem>
              <SelectItem value="filename-desc">Name Z-A</SelectItem>
              <SelectItem value="size-desc">Largest First</SelectItem>
              <SelectItem value="size-asc">Smallest First</SelectItem>
            </SelectContent>
          </Select>

          {/* Columns Toggle (Only for List View) */}
          {viewMode === "list" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="md"
                  className="hover-unified bg-background text-foreground border-border hover:bg-accent/10 px-4 shrink-0"
                >
                  <Columns className="h-4 w-4 text-muted-foreground" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 shadow-none border-border"
              >
                <DropdownMenuLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 px-2 py-1.5">
                  Toggle Columns
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuCheckboxItem
                  checked={!hiddenColumns.has("mimeType")}
                  onCheckedChange={() => toggleColumn("mimeType")}
                  className="text-xs font-medium"
                >
                  Type
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!hiddenColumns.has("size")}
                  onCheckedChange={() => toggleColumn("size")}
                  className="text-xs font-medium"
                >
                  Size
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!hiddenColumns.has("width")}
                  onCheckedChange={() => toggleColumn("width")}
                  className="text-xs font-medium"
                >
                  Dimensions
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!hiddenColumns.has("uploadedAt")}
                  onCheckedChange={() => toggleColumn("uploadedAt")}
                  className="text-xs font-medium"
                >
                  Uploaded Date
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-6">
            <MediaBulkActionBar
              selectedCount={selectedIds.size}
              onDelete={handleBulkDelete}
              onClear={handleClearSelection}
              isDeleting={isBulkDeleting}
              onMoveToFolder={handleMoveToFolder}
            />
          </div>
        )}

        {/* Inline folder navigation: breadcrumbs + the current level's
            folders. Always rendered (independent of the folder tree toggle)
            so drill-down navigation never moves. */}
        {(activeFolderId || hasFoldersToDisplay) && (
          <div className="mb-6">
            {activeFolderId && (
              <FolderBreadcrumbs
                activeFolderId={activeFolderId}
                onFolderSelect={setActiveFolderId}
                className="mb-4"
              />
            )}
            <FolderCardsRow
              folders={foldersToDisplay ?? []}
              activeFolderId={activeFolderId}
              onFolderSelect={setActiveFolderId}
              onCreateSubfolder={parentId => {
                setCreateFolderParentId(parentId);
                setIsCreateFolderDialogOpen(true);
              }}
              onRenameFolder={folderId => {
                setEditFolderId(folderId);
                setIsEditFolderDialogOpen(true);
              }}
              onDeleteFolder={(folderId, folderName) => {
                setDeleteFolderId(folderId);
                setDeleteFolderName(folderName);
                setIsDeleteFolderDialogOpen(true);
              }}
              openMenuId={openMenuId}
              onOpenMenuChange={setOpenMenuId}
            />
          </div>
        )}

        {/* Media Content - Grid or List view */}
        <div className="rounded-none  border border-border bg-card overflow-hidden">
          {viewMode === "grid" ? (
            <>
              <div className="p-6">
                <MediaGrid
                  media={data?.data || []}
                  isLoading={isLoading}
                  error={error}
                  selectedIds={selectedIds}
                  onSelectionChange={handleSelectionChange}
                  onItemClick={handleEditMedia}
                  onEdit={handleEditMedia}
                  onDelete={(media: Media) => handleDeleteItem(media)}
                  onCopyUrl={(url: string) => {
                    void navigator.clipboard.writeText(url);
                  }}
                  onDownload={(media: Media) => {
                    const a = document.createElement("a");
                    a.href = media.url;
                    a.download = media.filename;
                    a.click();
                  }}
                  onRetry={() => {
                    void refetch();
                  }}
                />
              </div>
              {/* Pagination for Grid View */}
              {!isLoading && !error && data && data.data.length > 0 && (
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  pageSizeOptions={[12, 24, 48, 96]}
                  showPageSizeSelector
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                />
              )}
            </>
          ) : (
            <>
              <MediaListView
                media={data?.data || []}
                isLoading={isLoading}
                error={error}
                selectedIds={selectedIds}
                hiddenColumns={hiddenColumns}
                onSelectionChange={handleSelectionChange}
                onToggleAll={handleToggleAll}
                onEdit={handleEditMedia}
                onDelete={(media: Media) => handleDeleteItem(media)}
                onRetry={() => {
                  void refetch();
                }}
              />

              {/* Pagination for List View */}
              {!isLoading && !error && data && data.data.length > 0 && (
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  pageSizeOptions={[12, 24, 48, 96]}
                  showPageSizeSelector
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                />
              )}
            </>
          )}
        </div>

        {/* Media Delete Dialog (single item) */}
        <MediaDeleteDialog
          open={isDeleteDialogOpen}
          media={mediaToDelete}
          onOpenChange={open => {
            setIsDeleteDialogOpen(open);
            if (!open) setMediaToDelete(null);
          }}
          onConfirm={handleConfirmDeleteItem}
          isLoading={isDeleting}
        />

        {/* Bulk Delete Dialog */}
        <AlertDialog
          open={isBulkDeleteDialogOpen}
          onOpenChange={open => {
            if (!open) setIsBulkDeleteDialogOpen(false);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {selectedIds.size}{" "}
                {selectedIds.size === 1 ? "file" : "files"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {selectedIds.size}{" "}
                {selectedIds.size === 1 ? "media file" : "media files"}? This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkDeleting}>
                Cancel
              </AlertDialogCancel>
              {/* Solid emphasis fill so white on-color text stays AA in dark mode. */}
              <AlertDialogAction
                onClick={handleConfirmBulkDelete}
                disabled={isBulkDeleting}
                className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90"
              >
                {isBulkDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Media Edit Dialog */}
        <MediaEditDialog
          open={isEditDialogOpen}
          media={editingMedia}
          onOpenChange={setIsEditDialogOpen}
          onSave={handleSaveMedia}
          isLoading={isUpdating}
          onDelete={m => {
            setMediaToDelete(m);
            setIsDeleteDialogOpen(true);
            setIsEditDialogOpen(false);
          }}
          onDownload={m => {
            void handleDownload(m);
          }}
          onCopyUrl={url => {
            void navigator.clipboard.writeText(url);
            toast.success("URL copied to clipboard");
          }}
        />

        {/* Create Folder Dialog */}
        <CreateFolderDialog
          open={isCreateFolderDialogOpen}
          onOpenChange={setIsCreateFolderDialogOpen}
          parentId={createFolderParentId}
          onSuccess={() => {
            void refetch();
          }}
        />

        {/* Edit Folder Dialog */}
        <EditFolderDialog
          open={isEditFolderDialogOpen}
          onOpenChange={setIsEditFolderDialogOpen}
          folderId={editFolderId}
          onSuccess={() => {
            setIsEditFolderDialogOpen(false);
          }}
        />

        {/* Delete Folder Dialog */}
        <DeleteFolderDialog
          open={isDeleteFolderDialogOpen}
          onOpenChange={setIsDeleteFolderDialogOpen}
          folderId={deleteFolderId}
          folderName={deleteFolderName}
          onSuccess={handleDeleteFolderSuccess}
        />

        {/* Move to Folder Dialog */}
        <MoveToFolderDialog
          open={isMoveToFolderDialogOpen}
          onOpenChange={setIsMoveToFolderDialogOpen}
          mediaIds={Array.from(selectedIds)}
          currentFolderId={activeFolderId}
          onSuccess={() => {
            void refetch();
            setSelectedIds(new Set());
          }}
        />
      </div>
    </div>
  );
}
