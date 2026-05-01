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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@revnixhq/ui";
import * as React from "react";

import {
  Search,
  List,
  ChevronRight,
  Folder as FolderIconComponent,
  Home,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
} from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import { Link } from "@admin/components/ui/link";
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

  // State: Filters
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<MediaType | "all">("all");
  const [sortBy, _setSortBy] = React.useState<
    "filename" | "uploadedAt" | "size"
  >(defaultSortBy);
  const [sortOrder, _setSortOrder] = React.useState<"asc" | "desc">(
    defaultSortOrder
  );

  // State: UI
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
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
    folderViewMode,
    setFolderViewMode,
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

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0); // Reset to page 1 when search changes
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Build query params
  const queryParams: MediaParams = {
    page: page + 1,
    pageSize,
    search: debouncedSearch || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    folderId: activeFolderId,
    sortBy,
    sortOrder,
  };

  // TanStack Query: Fetch media
  const { data, isLoading, error, refetch } = useMedia(queryParams);

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
    (media: Media[]) => {
      console.log("[MediaLibrary] Upload complete:", media.length, "files");
      // Refetch to show new uploads
      void refetch();
      // Clear selection
      setSelectedIds(new Set());
    },
    [refetch]
  );

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
    const idsArray = Array.from(selectedIds);
    void bulkDeleteMedia(idsArray, undefined, {
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
  const handleSearchChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleTypeFilterChange = React.useCallback((value: string) => {
    setTypeFilter(value as MediaType | "all");
    setPage(0); // Reset to page 1 when filter changes
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
  const hasSelection = selectedIds.size > 0;

  return (
    <div
      className={cn("flex min-h-[calc(100vh-4rem)] bg-background", className)}
    >
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background p-8 overflow-y-auto">
        {/* Page Breadcrumb (Move above the title) */}
        <nav
          className="flex items-center gap-2 text-sm text-muted-foreground mb-6"
          aria-label="Breadcrumb"
        >
          <Link
            href={ROUTES.DASHBOARD}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors duration-150"
          >
            <Home className="w-4 h-4" />
            <span>Dashboard</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground font-medium">Media Library</span>
        </nav>
        {/* Header Section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Media Library
            </h1>
            <p className="text-sm font-medium text-muted-foreground mt-1">
              {total} {total === 1 ? "file" : "files"}
              {activeFolderId && " in this folder"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Sidebar Toggle Group */}
            <div className="flex items-center bg-white dark:bg-slate-950 border border-border rounded-lg p-1 shrink-0 transition-all duration-200">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-md transition-all duration-200",
                  folderViewMode === "sidebar"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => setFolderViewMode("sidebar")}
                title="Show Sidebar"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-md transition-all duration-200",
                  folderViewMode === "grid"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => setFolderViewMode("grid")}
                title="Hide Sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            {/* View Toggle Group (Gallery) */}
            <div className="flex items-center bg-white dark:bg-slate-950 border border-border rounded-lg p-1 shrink-0 transition-all duration-200">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-md transition-all duration-200",
                  viewMode === "grid"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-primary hover:text-primary-foreground"
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
                  "h-8 w-8 rounded-md transition-all duration-200",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-primary hover:text-primary-foreground"
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
                "flex items-center gap-2 px-5 h-10 shrink-0 transition-all duration-200 font-bold tracking-tight rounded-xl",
                !isUploadCollapsed
                  ? "bg-primary/90 text-primary-foreground hover:bg-primary"
                  : "bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
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
          activeFolderId={activeFolderId}
          activeFolderName={activeFolderName}
          className={cn(!isUploadCollapsed && "mb-8")}
        />

        {/* Toolbar: Search + Filters */}
        <div
          className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6"
          suppressHydrationWarning
        >
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search media files..."
              value={search}
              onChange={handleSearchChange}
              className="pl-9 bg-white dark:bg-slate-950"
            />
          </div>

          {/* Type Filter */}
          <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
            <SelectTrigger className="w-full sm:w-[180px] hover-unified bg-white dark:bg-slate-950">
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
        </div>

        {/* Folder Breadcrumbs & Grid (Moved under search and filters) */}
        {folderViewMode === "grid" && (
          <div className="mb-6">
            <FolderBreadcrumbs
              activeFolderId={activeFolderId}
              onFolderSelect={setActiveFolderId}
              showRoot={false}
              className="mb-4"
            />
            {/* Root Folders Row */}
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 pb-4">
                {/* All Media (Root) Card */}
                <button
                  type="button"
                  onClick={() => setActiveFolderId(null)}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all duration-200 cursor-pointer",
                    !activeFolderId
                      ? "border-primary/20 bg-primary/5"
                      : "border-border bg-card hover:bg-muted/50 hover:border-border-strong"
                  )}
                >
                  <Home
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      !activeFolderId
                        ? "text-primary"
                        : "text-muted-foreground/70 group-hover:text-primary"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-xs font-semibold transition-colors",
                        !activeFolderId ? "text-primary" : "text-foreground"
                      )}
                    >
                      All Media
                    </p>
                  </div>
                </button>

                {/* Root Folders */}
                {rootFoldersList?.map(folder => {
                  const isActive = activeFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setActiveFolderId(folder.id)}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all duration-200 cursor-pointer",
                        isActive
                          ? "border-primary/20 bg-primary/5"
                          : "border-border bg-card hover:bg-muted/50 hover:border-border-strong"
                      )}
                    >
                      <FolderIconComponent
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground/70 group-hover:text-blue-500"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-xs font-semibold transition-colors",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground group-hover:text-foreground"
                          )}
                        >
                          {folder.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Child Subfolders Row (Only if in a folder and has children) */}
            {activeFolderId &&
              childSubfolders &&
              childSubfolders.length > 0 && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300 border-t border-border/50 pt-4 mt-2">
                  <div className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3 px-1">
                    Subfolders
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 pb-6">
                    {childSubfolders.map(folder => {
                      const isActive = activeFolderId === folder.id;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => setActiveFolderId(folder.id)}
                          className={cn(
                            "group flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all duration-200 cursor-pointer",
                            isActive
                              ? "border-primary/20 bg-primary/5"
                              : "border-border bg-card hover:bg-muted/50 hover:border-border-strong"
                          )}
                        >
                          <FolderIconComponent
                            className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground/70 group-hover:text-blue-500"
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "truncate text-xs font-semibold transition-colors",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground group-hover:text-foreground"
                              )}
                            >
                              {folder.name}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Bulk Action Bar (fixed at bottom) */}
        {hasSelection && (
          <MediaBulkActionBar
            selectedCount={selectedIds.size}
            onDelete={handleBulkDelete}
            onClear={handleClearSelection}
            isDeleting={isBulkDeleting}
            onMoveToFolder={handleMoveToFolder}
          />
        )}

        {/* Media Content - Grid or List view */}
        <div className="rounded-md border border-border bg-card overflow-hidden">
          {viewMode === "grid" ? (
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
          ) : (
            <>
              <MediaListView
                media={data?.data || []}
                isLoading={isLoading}
                error={error}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
                onToggleAll={handleToggleAll}
                onEdit={handleEditMedia}
                onDelete={(media: Media) => handleDeleteItem(media)}
                onRetry={() => {
                  void refetch();
                }}
              />

              {/* Pagination for List View - Inside Boxed Container */}
              {!isLoading && !error && data && data.data.length > 0 && (
                <div className="border-t border-border bg-[hsl(var(--table-header-bg))] p-4">
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    pageSizeOptions={[12, 24, 48, 96]}
                    showPageSizeSelector
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                  />
                </div>
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
              <AlertDialogAction
                onClick={handleConfirmBulkDelete}
                disabled={isBulkDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
