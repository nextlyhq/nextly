"use client";

/**
 * MediaLibrary Component
 *
 * Complete media management interface with upload, browse, search, edit, and delete functionality.
 * Integrates MediaGrid, MediaUploadDropzone, Pagination, and search/filter controls.
 *
 * An item opens in a details panel beside the grid, which can expand to a
 * full-screen viewer; the page owns which item is open and returns focus to
 * that item's tile when the panel closes.
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
  toast,
} from "@nextlyhq/ui";
import * as React from "react";

import { Breadcrumbs, Pagination } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import {
  useMedia,
  useDeleteMedia,
  useBulkDeleteMedia,
  useUpdateMedia,
  useFolderById,
  useFolderContents,
  useSubfolders,
  useRootFolders,
} from "@admin/hooks/queries/useMedia";
import { useCan } from "@admin/hooks/useCan";
import { usePagination } from "@admin/hooks/usePagination";
import {
  usePersistedState,
  usePersistedStringSet,
} from "@admin/hooks/usePersistedState";
import { copyableMediaUrl } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaParams, MediaType } from "@admin/types/media";

import { CreateFolderDialog } from "./CreateFolderDialog";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { EditFolderDialog } from "./EditFolderDialog";
import { FolderBreadcrumbs } from "./FolderBreadcrumbs";
import { FolderCardsRow } from "./FolderCardsRow";
import { MediaBulkActionBar } from "./MediaBulkActionBar";
import { MediaDeleteDialog } from "./MediaDeleteDialog";
import type { MediaSave } from "./MediaDetails";
import { MediaDetailsPanel } from "./MediaDetailsPanel";
import { useMediaDetailsLayout } from "./MediaDetailsPanel/useMediaDetailsLayout";
import { MediaGrid } from "./MediaGrid";
import { MediaLibraryToolbar } from "./MediaLibraryToolbar";
import { MediaListView } from "./MediaListView";
import { MediaUploadDropzone } from "./MediaUploadDropzone";
import { MediaViewer } from "./MediaViewer";
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
 * Focuses the entry that stands for an item, in whichever view is showing:
 * a grid tile, or a list row. Both carry the item's id as `data-row-id`. The
 * list draws each item twice, as a card for a narrow table and a row for a
 * wide one, and only the one on screen can take focus, so each is tried in
 * turn. Returns whether one took it.
 */
function focusMediaEntry(container: HTMLElement | null, id: string): boolean {
  const entries = Array.from(
    container?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []
  ).filter(element => element.dataset.rowId === id);
  for (const entry of entries) {
    entry.focus();
    if (document.activeElement === entry) return true;
  }
  return false;
}

/**
 * What an empty listing says under its heading: why it's empty when a search
 * or a type narrowed it, and otherwise what to do next, which for a person
 * who can't upload is nothing.
 */
function emptyLibraryMessage({
  filtered,
  canUpload,
}: {
  filtered: boolean;
  canUpload: boolean;
}): string {
  if (filtered) return "Nothing matches this search or filter.";
  if (canUpload) return "Add some with Upload files above.";
  return "Nothing has been added here yet.";
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
}: MediaLibraryProps = {}): React.JSX.Element {
  // State: Pagination
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination({
    initialPageSize: defaultPageSize,
  });
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

  // State: the item whose details are open, and whether they are expanded to
  // the full-screen viewer. By id, so the panel always shows the item as the
  // latest list has it, including after its own saves.
  const [openMediaId, setOpenMediaId] = React.useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = React.useState(false);
  // Focus moves here once the panel has closed: the tile of the item that was
  // on screen, which may not be the one that opened the panel.
  const [focusReturnId, setFocusReturnId] = React.useState<string | null>(null);
  // What had focus when the panel opened: the fallback when that tile is gone.
  const openerRef = React.useRef<HTMLElement | null>(null);
  const libraryRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const detailsLayout = useMediaDetailsLayout(libraryRef);

  // What this person may do. A reader browses and reads; everything that
  // writes is left out rather than offered and refused by the server.
  const canUpload = useCan("create-media");
  const canEdit = useCan("update-media");
  const canDelete = useCan("delete-media");

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
    resetPage();
  }, [activeFolderId, resetPage]);

  const [isCreateFolderDialogOpen, setIsCreateFolderDialogOpen] =
    React.useState(false);
  const [createFolderParentId, setCreateFolderParentId] = React.useState<
    string | undefined
  >();
  const [isMoveToFolderDialogOpen, setIsMoveToFolderDialogOpen] =
    React.useState(false);
  // The items a move is for: one from the details panel, or null for the
  // bulk selection.
  const [moveMediaIds, setMoveMediaIds] = React.useState<string[] | null>(null);
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
      resetPage(); // Reset to page 1 when search changes
    }, 300);

    return () => clearTimeout(timer);
  }, [search, resetPage]);

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
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } =
    useMedia(queryParams);

  // TanStack Query: Delete single item
  const { mutate: deleteMedia, isPending: isDeleting } = useDeleteMedia();

  // TanStack Query: Bulk delete
  const { mutate: bulkDeleteMedia, isPending: isBulkDeleting } =
    useBulkDeleteMedia();

  // TanStack Query: Update media
  const { mutateAsync: updateMediaAsync } = useUpdateMedia();

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
  const handleUploadComplete = React.useCallback((_media: Media[]) => {
    // The dropzone has already invalidated the media lists, which refetches
    // the one on screen; asking again here would fetch it twice.
    setSelectedIds(new Set());
  }, []);

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

  // Handlers: Details
  const items = data?.data;
  const openIndex =
    openMediaId && items ? items.findIndex(m => m.id === openMediaId) : -1;
  const openMedia = items && openIndex >= 0 ? items[openIndex] : null;
  const { data: openMediaFolder } = useFolderById(openMedia?.folderId ?? null);
  // An item at the top level has no folder; one in a folder shows its name
  // once it has arrived.
  const openMediaFolderName = openMedia?.folderId
    ? (openMediaFolder?.name ?? "…")
    : null;

  const handleOpenDetails = React.useCallback(
    (media: Media) => {
      if (!openMediaId && document.activeElement instanceof HTMLElement) {
        openerRef.current = document.activeElement;
      }
      setOpenMediaId(media.id);
    },
    [openMediaId]
  );

  const handleCloseDetails = React.useCallback(() => {
    setIsViewerOpen(false);
    if (openMediaId) setFocusReturnId(openMediaId);
    setOpenMediaId(null);
  }, [openMediaId]);

  // The open item left the list (deleted, moved out of this folder, or on
  // another page now): the panel closes rather than show a stale copy. Only
  // once the list has settled, so a refetch in flight closes nothing.
  React.useEffect(() => {
    if (openMediaId && items && !isPlaceholderData && openIndex < 0) {
      handleCloseDetails();
    }
  }, [openMediaId, items, isPlaceholderData, openIndex, handleCloseDetails]);

  // Focus back to the tile or row of the item that was on screen when the
  // panel closed, then to whatever opened it, then to the page title,
  // whichever still exists.
  React.useEffect(() => {
    if (!focusReturnId) return;
    setFocusReturnId(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (focusMediaEntry(libraryRef.current, focusReturnId)) return;
    if (opener?.isConnected) opener.focus();
    else headingRef.current?.focus();
  }, [focusReturnId]);

  // Escape closes the panel from anywhere in the library while it sits
  // beside the grid. A dialog or menu opened from the page is portaled out of
  // the library's element, so its own Escape never reaches this.
  const handleLibraryKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!openMediaId || detailsLayout !== "beside") return;
      if (
        !(event.target instanceof Node) ||
        !libraryRef.current?.contains(event.target)
      ) {
        return;
      }
      event.preventDefault();
      handleCloseDetails();
    },
    [openMediaId, detailsLayout, handleCloseDetails]
  );

  const handleSaveMedia: MediaSave = React.useCallback(
    (mediaId, updates) => updateMediaAsync({ mediaId, updates }),
    [updateMediaAsync]
  );

  const handleCopyUrl = React.useCallback((media: Media) => {
    void navigator.clipboard.writeText(copyableMediaUrl(media.url));
    toast.success("URL copied to clipboard");
  }, []);

  const handleMoveOne = React.useCallback((media: Media) => {
    setMoveMediaIds([media.id]);
    setIsMoveToFolderDialogOpen(true);
  }, []);

  // Handlers: Pagination
  const handlePageChange = React.useCallback(
    (newPage: number) => {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setPage]
  );

  // Handlers: Filters
  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value);
  }, []);

  const handleTypeFilterChange = React.useCallback(
    (value: string) => {
      setTypeFilter(value as MediaType | "all");
      resetPage(); // Reset to page 1 when filter changes
    },
    [resetPage]
  );

  const handleSortChange = React.useCallback(
    (value: string) => {
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
        resetPage(); // Reset to page 1 when ordering changes
      }
    },
    [resetPage]
  );

  // Handlers: Folders

  const handleDeleteFolderSuccess = React.useCallback(() => {
    if (deleteFolderId === activeFolderId) {
      setActiveFolderId(null);
      resetPage();
    }
  }, [deleteFolderId, activeFolderId, setActiveFolderId, resetPage]);

  const handleMoveToFolder = React.useCallback(() => {
    if (selectedIds.size === 0) return;
    setMoveMediaIds(null);
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

  // Previous and next within the page on screen. Absent at either end
  // rather than wrapping round, which would hide that more pages exist.
  const goToPrevious =
    items && openIndex > 0
      ? () => setOpenMediaId(items[openIndex - 1].id)
      : undefined;
  const goToNext =
    items && openIndex >= 0 && openIndex < items.length - 1
      ? () => setOpenMediaId(items[openIndex + 1].id)
      : undefined;

  const emptyStateMessage = emptyLibraryMessage({
    filtered: Boolean(debouncedSearch) || typeFilter !== "all",
    canUpload,
  });

  // Ticking tiles leads only to Delete and Move, so a person who may do
  // neither is offered no checkboxes.
  const selectionChange =
    canEdit || canDelete ? handleSelectionChange : undefined;

  // What the panel and the viewer share: the same item, the same saves and
  // the same actions, each write offered only to a person who may make it.
  const details = openMedia
    ? {
        media: openMedia,
        folderName: openMediaFolderName,
        readOnly: !canEdit,
        onSave: handleSaveMedia,
        onPrevious: goToPrevious,
        onNext: goToNext,
        onCopyUrl: handleCopyUrl,
        onDownload: (media: Media) => void handleDownload(media),
        onMove: canEdit ? handleMoveOne : undefined,
        onDelete: canDelete ? handleDeleteItem : undefined,
      }
    : null;

  return (
    // A column rather than the scroll container: the page's main area
    // scrolls, which is what lets the details panel stick beside the grid.
    <div
      ref={libraryRef}
      className={cn(
        "flex min-h-[calc(100vh-4rem)] min-w-0 flex-col",
        className
      )}
      onKeyDown={handleLibraryKeyDown}
    >
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
          { label: "Media Library" },
        ]}
        className="mb-6"
      />

      <MediaLibraryToolbar
        total={total}
        inFolder={Boolean(activeFolderId)}
        headingRef={headingRef}
        search={{
          value: search,
          onChange: handleSearchChange,
          isLoading: isFetching,
        }}
        typeFilter={{
          value: typeFilter,
          onChange: handleTypeFilterChange,
          allowedTypes,
        }}
        sort={{ value: `${sortBy}-${sortOrder}`, onChange: handleSortChange }}
        view={{
          mode: viewMode,
          onChange: setViewMode,
          hiddenColumns,
          onToggleColumn: toggleColumn,
        }}
        folderTree={{
          visible: isFolderTreeVisible,
          onToggle: () => setIsFolderTreeVisible(!isFolderTreeVisible),
        }}
        upload={{
          allowed: canUpload,
          open: !isUploadCollapsed,
          onToggle: () => setIsUploadCollapsed(!isUploadCollapsed),
        }}
      />

      {/* A reader has no drop target: nothing they drop could be stored. */}
      {canUpload && (
        <MediaUploadDropzone
          isCollapsed={isUploadCollapsed}
          onToggleCollapse={() => setIsUploadCollapsed(!isUploadCollapsed)}
          onUploadComplete={handleUploadComplete}
          onUploadStart={handleUploadStart}
          activeFolderId={activeFolderId}
          activeFolderName={activeFolderName}
          className={cn(!isUploadCollapsed && "mb-8")}
        />
      )}

      {/* The grid and, beside it, the open item's details. */}
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
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
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {viewMode === "grid" ? (
              <>
                <div className="p-4 sm:p-6">
                  <MediaGrid
                    media={data?.data || []}
                    isLoading={isLoading}
                    error={error}
                    selectedIds={selectedIds}
                    currentId={openMedia?.id ?? null}
                    onSelectionChange={selectionChange}
                    onItemClick={handleOpenDetails}
                    onEdit={handleOpenDetails}
                    onDelete={canDelete ? handleDeleteItem : undefined}
                    onCopyUrl={(url: string) => {
                      void navigator.clipboard.writeText(copyableMediaUrl(url));
                    }}
                    onDownload={(media: Media) => {
                      void handleDownload(media);
                    }}
                    onRetry={() => {
                      void refetch();
                    }}
                    emptyStateMessage={emptyStateMessage}
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
                    // Held while the rows on screen stand in for a result still
                    // loading: their page count is the old result's, and a page
                    // picked from it could be one the new result doesn't have.
                    isLoading={isPlaceholderData}
                    onPageChange={handlePageChange}
                    onPageSizeChange={setPageSize}
                    // This page renders TWO pagers -- one per view -- and they
                    // are identical in every other prop, so the name is the only
                    // thing that tells a screen reader which list it moves.
                    // Rendered directly rather than handed to a table because a
                    // grid has no row-versus-card view to place one for; the list
                    // view's pager goes to the table below.
                    ariaLabel="Media grid pagination"
                  />
                )}
              </>
            ) : (
              <MediaListView
                media={data?.data || []}
                isLoading={isLoading}
                error={error}
                selectedIds={selectedIds}
                hiddenColumns={hiddenColumns}
                onSelectionChange={selectionChange}
                onToggleAll={handleToggleAll}
                onItemClick={handleOpenDetails}
                onEdit={handleOpenDetails}
                onDelete={canDelete ? handleDeleteItem : undefined}
                onRetry={() => {
                  void refetch();
                }}
                emptyStateMessage={emptyStateMessage}
                // The list view is a table, so its pager goes to the table
                // rather than beside it. The grid branch above keeps its own,
                // because a grid has no row-versus-card view to place it for.
                pagination={
                  !isLoading && !error && data && data.data.length > 0
                    ? {
                        currentPage: page,
                        totalPages,
                        pageSize,
                        pageSizeOptions: [12, 24, 48, 96],
                        showPageSizeSelector: true,
                        // Held for the same reason as the grid's pager.
                        isLoading: isPlaceholderData,
                        onPageChange: handlePageChange,
                        onPageSizeChange: setPageSize,
                        // The other half of the pair above: same props, other
                        // view, so the name is what tells a screen reader
                        // which list it moves.
                        ariaLabel: "Media list pagination",
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>

        {details && detailsLayout === "beside" && (
          <MediaDetailsPanel
            {...details}
            layout="beside"
            onExpand={() => setIsViewerOpen(true)}
            onClose={handleCloseDetails}
          />
        )}
      </div>

      {/* Too narrow for the panel beside the grid: the same panel, over it. */}
      {details && detailsLayout === "over" && (
        <MediaDetailsPanel
          {...details}
          layout="over"
          onExpand={() => setIsViewerOpen(true)}
          onClose={handleCloseDetails}
        />
      )}

      {details && (
        <MediaViewer
          {...details}
          open={isViewerOpen}
          // Escape or the close button goes back to the panel, not out of it.
          onClose={() => setIsViewerOpen(false)}
        />
      )}

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
            {/* The `-solid` emphasis fill, paired with an on-color ink that flips: `text-destructive-foreground` is white on the light fill and BLACK on the lighter dark-mode fill (6.90:1). One ink cannot clear 4.5:1 on both, which is why the token flips rather than the fill compensating. The LIGHT pairing is 3.84:1 and does NOT clear it: the fill takes the reference red, and that failure is recorded in packages/ui/src/styles/contrast/accepted.ts rather than fixed here. */}
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-600"
            >
              {isBulkDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Move to Folder Dialog: one item from the details panel, or the bulk
          selection. Only a bulk move clears the selection. */}
      <MoveToFolderDialog
        open={isMoveToFolderDialogOpen}
        onOpenChange={setIsMoveToFolderDialogOpen}
        mediaIds={moveMediaIds ?? Array.from(selectedIds)}
        currentFolderId={activeFolderId}
        onSuccess={() => {
          void refetch();
          if (moveMediaIds === null) setSelectedIds(new Set());
        }}
      />
    </div>
  );
}
