"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";

import {
  Upload,
  Grid3x3,
  LayoutDashboard,
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  FolderPlus,
} from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import {
  useCreateFolder,
  useInfiniteMedia,
  useRootFolders,
  useSubfolders,
  useFolderContents,
} from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";
import type { Media, MediaFolder, MediaType } from "@admin/types/media";
import type { MediaPickerDialogProps } from "@admin/types/ui/media-picker-dialog";

import { FolderBreadcrumbs } from "../FolderBreadcrumbs";
import { MediaGrid } from "../MediaGrid";
import { MediaUploadDropzone } from "../MediaUploadDropzone";

/**
 * Initial page size for media picker dialog
 * Show 20 items initially
 */
const INITIAL_PAGE_SIZE = 20;

/**
 * Media Picker Dialog Component
 *
 * A reusable dialog for selecting media from the media library.
 * Supports single-select and multi-select modes, with integrated upload functionality.
 *
 * Features:
 * - Single-select or multi-select modes
 * - Search and filter media by type
 * - Sort media by date/name/size
 * - Upload new media within the dialog
 * - Pre-select existing media items
 * - File type filtering for uploads
 * - Responsive design (mobile-optimized)
 *
 * Design System:
 * - Uses Dialog component (size="xl" for 896px width)
 * - Tabs for "Media Library" and "Upload" sections
 * - Reuses MediaGrid, MediaCard, SearchBar components
 * - Footer shows selection count and action buttons
 *
 * Accessibility:
 * - WCAG 2.2 AA compliant
 * - Full keyboard navigation
 * - Screen reader support (aria-labels, live regions)
 * - Focus management (dialog traps focus, returns on close)
 *
 * @example Single-select mode
 * ```tsx
 * <MediaPickerDialog
 *   mode="single"
 *   open={open}
 *   onOpenChange={setOpen}
 *   onSelect={(media) => console.log("Selected:", media[0])}
 * />
 * ```
 *
 * @example Multi-select with initial selection
 * ```tsx
 * <MediaPickerDialog
 *   mode="multi"
 *   open={open}
 *   onOpenChange={setOpen}
 *   onSelect={handleSelect}
 *   initialSelectedIds={new Set(existingMedia.map(m => m.id))}
 * />
 * ```
 */
export function MediaPickerDialog({
  mode = "single",
  open,
  onOpenChange,
  onSelect,
  initialSelectedIds = new Set(),
  accept,
  maxFileSize,
  allowCreate = true,
  title,
  className,
}: MediaPickerDialogProps) {
  const queryClient = useQueryClient();

  // Refetch folder/media data when dialog opens to ensure fresh data
  useEffect(() => {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
      void queryClient.invalidateQueries({ queryKey: ["media-infinite"] });
    }
  }, [open, queryClient]);

  // Active tab state
  const [activeTab, setActiveTab] = useState<"library" | "upload">("library");

  // Selection state (local state, initialized from initialSelectedIds)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialSelectedIds)
  );

  // Intersection observer ref for infinite scroll
  const observerTarget = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollContainerReady, setScrollContainerReady] = useState(false);

  // Callback ref to detect when scroll container is mounted
  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    if (node) {
      setScrollContainerReady(true);
    }
  }, []);

  // Cache of selected media objects (to preserve data when items are filtered out of view)
  const [selectedMediaCache, setSelectedMediaCache] = useState<
    Map<string, Media>
  >(new Map());

  // Folder navigation state
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const { data: rootFolders } = useRootFolders();
  const { data: childSubfolders } = useSubfolders(activeFolderId ?? undefined);
  const { data: folderContents } = useFolderContents(activeFolderId);
  const displayFolders = activeFolderId ? childSubfolders : rootFolders;
  const breadcrumbs = folderContents?.breadcrumbs ?? [];
  const [isUploadFolderPickerOpen, setIsUploadFolderPickerOpen] =
    useState(false);

  // Inline "New folder" state for the Upload-tab destination picker
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const {
    mutate: createFolder,
    isPending: isCreatingFolderPending,
    error: createFolderError,
    reset: resetCreateFolder,
  } = useCreateFolder();

  const handleStartCreateFolder = useCallback(() => {
    setNewFolderName("");
    resetCreateFolder();
    setIsCreatingFolder(true);
  }, [resetCreateFolder]);

  const handleCancelCreateFolder = useCallback(() => {
    setIsCreatingFolder(false);
    setNewFolderName("");
    resetCreateFolder();
  }, [resetCreateFolder]);

  const handleSubmitCreateFolder = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = newFolderName.trim();
      if (!trimmed) return;
      createFolder(
        { name: trimmed, parentId: activeFolderId ?? undefined },
        {
          onSuccess: newFolder => {
            setActiveFolderId(newFolder.id);
            setIsCreatingFolder(false);
            setNewFolderName("");
            setIsUploadFolderPickerOpen(false);
            toast.success("Folder created", {
              description: `"${newFolder.name}" is ready for uploads.`,
            });
          },
          onError: err => {
            toast.error("Failed to create folder", {
              description: err instanceof Error ? err.message : undefined,
            });
          },
        }
      );
    },
    [newFolderName, activeFolderId, createFolder]
  );

  // Search and filter state
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | MediaType>("all");
  const [sortBy, setSortBy] = useState<"uploadedAt" | "filename" | "size">(
    "uploadedAt"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Convert accept prop to MediaType filter
  const defaultTypeFilter = useMemo((): MediaType | undefined => {
    if (!accept) return undefined;

    // Check if accept contains image types
    if (accept.includes("image/") || accept.includes("image/*")) {
      return "image";
    }
    // Check if accept contains video types
    if (accept.includes("video/") || accept.includes("video/*")) {
      return "video";
    }
    // Check if accept contains audio types
    if (accept.includes("audio/") || accept.includes("audio/*")) {
      return "audio";
    }
    // Check if accept contains document types
    if (
      accept.includes("application/pdf") ||
      accept.includes("application/msword") ||
      accept.includes("application/vnd")
    ) {
      return "document";
    }

    return undefined;
  }, [accept]);

  // Fetch media using TanStack Query
  // Apply field constraint as default type filter if user hasn't selected a different type
  const effectiveTypeFilter =
    typeFilter !== "all" ? typeFilter : defaultTypeFilter;

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteMedia({
    limit: INITIAL_PAGE_SIZE,
    search: search || undefined,
    type: effectiveTypeFilter,
    folderId: activeFolderId ?? undefined,
    sortBy,
    sortOrder,
  });

  // Flatten all pages into single media array
  const media = useMemo(() => {
    return data?.pages.flatMap(page => page.data) ?? [];
  }, [data?.pages]);

  // Get total count from first page meta
  const totalCount = data?.pages[0]?.meta.total ?? 0;

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!scrollContainerRef.current || !observerTarget.current) {
      return;
    }

    if (!hasNextPage || isFetchingNextPage || activeTab !== "library") {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const target = observerTarget.current;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      {
        root: scrollContainer,
        rootMargin: "100px",
        threshold: 0.1,
      }
    );

    observer.observe(target);

    return () => {
      observer.unobserve(target);
    };
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    activeTab,
    media.length,
    scrollContainerReady,
  ]);

  // Handle selection change
  const handleSelectionChange = useCallback(
    (id: string) => {
      // Find the media item in current list
      const mediaItem = media.find(m => m.id === id);

      setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (mode === "single") {
          // Single-select: replace selection
          newSet.clear();
          newSet.add(id);
        } else {
          // Multi-select: toggle selection
          if (newSet.has(id)) {
            newSet.delete(id);
          } else {
            newSet.add(id);
          }
        }
        return newSet;
      });

      // Update media cache
      setSelectedMediaCache(prev => {
        const newCache = new Map(prev);
        if (mode === "single") {
          // Single-select: clear cache and add new item
          newCache.clear();
          if (mediaItem) {
            newCache.set(id, mediaItem);
          }
        } else {
          // Multi-select: toggle in cache
          if (newCache.has(id)) {
            newCache.delete(id);
          } else if (mediaItem) {
            newCache.set(id, mediaItem);
          }
        }
        return newCache;
      });
    },
    [mode, media]
  );

  // Handle search change
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  // Handle type filter change
  const handleTypeFilterChange = useCallback((value: string) => {
    setTypeFilter(value as "all" | MediaType);
  }, []);

  // Handle sort change
  const handleSortChange = useCallback((value: string) => {
    const [newSortBy, newSortOrder] = value.split("-") as [
      "uploadedAt" | "filename" | "size",
      "asc" | "desc",
    ];
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
  }, []);

  // Handle upload complete
  const handleUploadComplete = useCallback(
    async (uploadedMedia: Media[]) => {
      // Switch to library tab
      setActiveTab("library");

      // Add uploaded items to cache
      setSelectedMediaCache(prev => {
        const newCache = new Map(prev);
        if (mode === "single") {
          newCache.clear();
          if (uploadedMedia.length > 0) {
            const lastItem = uploadedMedia[uploadedMedia.length - 1];
            newCache.set(lastItem.id, lastItem);
          }
        } else {
          uploadedMedia.forEach(m => newCache.set(m.id, m));
        }
        return newCache;
      });

      try {
        // Wait for refetch to complete before selecting items
        // This prevents race conditions where items are selected before they appear in the list
        await refetch();

        // Auto-select uploaded media (after refetch completes)
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          if (mode === "single") {
            // Single-select: select last uploaded item
            newSet.clear();
            if (uploadedMedia.length > 0) {
              newSet.add(uploadedMedia[uploadedMedia.length - 1].id);
            }
          } else {
            // Multi-select: add all uploaded items
            uploadedMedia.forEach(m => newSet.add(m.id));
          }
          return newSet;
        });
      } catch (error) {
        // Log error but don't block the flow
        // The upload itself succeeded, we just couldn't refresh the list
        console.error("Failed to refresh media library after upload:", error);
        // Still auto-select the uploaded items even if refetch failed
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          if (mode === "single") {
            newSet.clear();
            if (uploadedMedia.length > 0) {
              newSet.add(uploadedMedia[uploadedMedia.length - 1].id);
            }
          } else {
            uploadedMedia.forEach(m => newSet.add(m.id));
          }
          return newSet;
        });
      }
    },
    [mode, refetch]
  );

  // Handle select button click
  const handleSelect = useCallback(() => {
    // Get selected media from cache (preserves items even if filtered out of view)
    // Fall back to filtering current media for items not in cache
    const selectedMedia: Media[] = [];
    selectedIds.forEach(id => {
      const cachedItem = selectedMediaCache.get(id);
      if (cachedItem) {
        selectedMedia.push(cachedItem);
      } else {
        // Try to find in current media list (for items selected before cache was implemented)
        const mediaItem = media.find(m => m.id === id);
        if (mediaItem) {
          selectedMedia.push(mediaItem);
        }
      }
    });
    onSelect(selectedMedia);
  }, [media, selectedIds, selectedMediaCache, onSelect]);

  // Handle cancel button click
  const handleCancel = useCallback(() => {
    setSelectedIds(new Set(initialSelectedIds)); // Reset to initial selection
    setSelectedMediaCache(new Map()); // Clear cache
    onOpenChange(false);
  }, [initialSelectedIds, onOpenChange]);

  // Handle dialog close (backdrop click, Escape key)
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        // Reset selection and cache when closing
        setSelectedIds(new Set(initialSelectedIds));
        setSelectedMediaCache(new Map());
      }
      onOpenChange(newOpen);
    },
    [initialSelectedIds, onOpenChange]
  );

  // Selected count for footer display
  const selectedCount = selectedIds.size;

  // Determine dialog title
  const dialogTitle = useMemo(() => {
    if (title) return title;
    if (accept?.includes("image")) return "Select Image";
    if (accept?.includes("video")) return "Select Video";
    return "Select Media";
  }, [title, accept]);

  // Determine dialog description
  const dialogDescription = useMemo(() => {
    const selectText =
      mode === "single" ? "one media item" : "one or more media items";

    // Add type constraint info if present
    let typeInfo = "";
    if (defaultTypeFilter) {
      const typeLabel = {
        image: "images",
        video: "videos",
        audio: "audio files",
        document: "documents",
        other: "files",
      }[defaultTypeFilter];
      typeInfo = ` Only ${typeLabel} are shown.`;
    }

    if (allowCreate) {
      return `Choose ${selectText} from your library or upload new files.${typeInfo}`;
    }
    return `Choose ${selectText} from your library.${typeInfo}`;
  }, [mode, allowCreate, defaultTypeFilter]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" className={className}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as typeof activeTab)}
          className="w-full"
        >
          {allowCreate ? (
            <TabsList className="grid w-full grid-cols-2 h-10">
              <TabsTrigger value="library" className="gap-2">
                <Grid3x3 className="h-4 w-4" />
                <span>Media Library</span>
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                <span>Upload</span>
              </TabsTrigger>
            </TabsList>
          ) : null}

          {/* Media Library Tab */}
          <TabsContent value="library" className="mt-4 space-y-4">
            {/* Breadcrumb Navigation */}
            <FolderBreadcrumbs
              activeFolderId={activeFolderId}
              onFolderSelect={setActiveFolderId}
              className="text-xs"
            />

            {/* Child Folder Chips */}
            {displayFolders && displayFolders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {displayFolders.map(folder => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setActiveFolderId(folder.id)}
                    className="flex items-center gap-1.5 rounded-none border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    <span className="text-muted-foreground">
                      <FolderIcon className="h-3.5 w-3.5" />
                    </span>
                    {folder.name}
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {/* Search and Filters */}
            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <div className="flex-1 sm:max-w-xs">
                <SearchBar
                  placeholder="Search media..."
                  value={search}
                  onChange={handleSearchChange}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Select
                  value={typeFilter}
                  onValueChange={handleTypeFilterChange}
                >
                  <SelectTrigger className="w-full sm:w-[140px] hover-unified">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                    <SelectItem value="document">Documents</SelectItem>
                    <SelectItem value="audio">Audio</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={`${sortBy}-${sortOrder}`}
                  onValueChange={handleSortChange}
                >
                  <SelectTrigger className="w-full sm:w-40 hover-unified">
                    <SelectValue placeholder="Sort by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uploadedAt-desc">
                      Newest First
                    </SelectItem>
                    <SelectItem value="uploadedAt-asc">Oldest First</SelectItem>
                    <SelectItem value="filename-asc">Name A-Z</SelectItem>
                    <SelectItem value="filename-desc">Name Z-A</SelectItem>
                    <SelectItem value="size-desc">Largest First</SelectItem>
                    <SelectItem value="size-asc">Smallest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Media Grid */}
            <div
              ref={setScrollContainerRef}
              className="max-h-[400px] min-h-[200px] w-full overflow-y-auto"
            >
              <MediaGrid
                media={media}
                isLoading={isLoading}
                error={error}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
                onRetry={() => void refetch()}
                emptyStateMessage={
                  allowCreate ? (
                    <>
                      No media available. Please upload media via the{" "}
                      <a
                        href="/admin/media"
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Media Library
                      </a>{" "}
                      first, or use the Upload tab above.
                    </>
                  ) : (
                    <>
                      No media available. Please upload media via the{" "}
                      <a
                        href="/admin/media"
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Media Library
                      </a>{" "}
                      first.
                    </>
                  )
                }
              />

              {/* Loading indicator for infinite scroll */}
              {isFetchingNextPage && !isLoading && (
                <div className="text-center py-6">
                  <div className="inline-block animate-spin rounded-none h-6 w-6 border-b-2 border-primary"></div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Loading more...
                  </p>
                </div>
              )}

              {/* Intersection observer target */}
              {hasNextPage && !isLoading && (
                <div ref={observerTarget} className="h-4" />
              )}

              {/* No more images message */}
              {!hasNextPage && media.length > 0 && !isLoading && (
                <p className="text-center text-muted-foreground py-4 text-xs">
                  All {totalCount} files loaded
                </p>
              )}
            </div>
          </TabsContent>

          {/* Upload Tab - only shown when allowCreate is true */}
          {allowCreate && (
            <TabsContent value="upload" className="mt-4 space-y-3">
              {/* Folder selector for upload */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Upload to:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setIsUploadFolderPickerOpen(!isUploadFolderPickerOpen)
                    }
                    className="flex items-center gap-1.5 rounded-none border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent cursor-pointer"
                  >
                    {activeFolderId ? (
                      <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span>
                      {activeFolderId
                        ? breadcrumbs
                            .filter(c => c.id !== "root")
                            .map(c => c.name)
                            .join(" / ") || "Folder"
                        : "Root (All Media)"}
                    </span>
                    {isUploadFolderPickerOpen ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                </div>

                {isUploadFolderPickerOpen && (
                  <div className="max-h-[200px] space-y-0.5 overflow-y-auto rounded-none border border-border p-1.5">
                    {isCreatingFolder ? (
                      <form
                        onSubmit={handleSubmitCreateFolder}
                        className="space-y-1.5 rounded-none border border-dashed border-primary/40 bg-primary/5 p-2"
                      >
                        <Input
                          autoFocus
                          placeholder="Folder name"
                          value={newFolderName}
                          onChange={e => setNewFolderName(e.target.value)}
                          disabled={isCreatingFolderPending}
                          aria-label="New folder name"
                          className="h-7 text-xs"
                        />
                        {createFolderError && (
                          <div className="text-[11px] text-destructive">
                            {createFolderError.message ||
                              "Failed to create folder"}
                          </div>
                        )}
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={handleCancelCreateFolder}
                            disabled={isCreatingFolderPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={
                              isCreatingFolderPending || !newFolderName.trim()
                            }
                          >
                            {isCreatingFolderPending ? "Creating..." : "Create"}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartCreateFolder}
                        className="flex w-full items-center gap-2 rounded-none border border-dashed border-border px-2 py-1.5 text-xs transition-colors hover:border-primary/50 hover:bg-accent"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        <span>New folder</span>
                        {activeFolderId && (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            inside current
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFolderId(null);
                        setIsUploadFolderPickerOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-xs transition-colors hover:bg-accent cursor-pointer",
                        activeFolderId === null && "bg-accent font-medium"
                      )}
                    >
                      <LayoutDashboard className="h-3.5 w-3.5" />
                      Root (All Media)
                    </button>
                    {rootFolders?.map(folder => (
                      <PickerFolderItem
                        key={folder.id}
                        folder={folder}
                        level={0}
                        activeFolderId={activeFolderId}
                        onSelect={(id: string) => {
                          setActiveFolderId(id);
                          setIsUploadFolderPickerOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <MediaUploadDropzone
                onUploadComplete={media => {
                  void handleUploadComplete(media);
                }}
                isCollapsed={false}
                accept={accept}
                maxFileSize={maxFileSize}
                activeFolderId={activeFolderId}
                activeFolderName={
                  activeFolderId
                    ? breadcrumbs
                        .filter(c => c.id !== "root")
                        .map(c => c.name)
                        .join(" / ") || null
                    : null
                }
                className="min-h-[300px]"
              />
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div
            className="text-sm text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {selectedCount > 0 ? (
              <span>
                {selectedCount} {selectedCount === 1 ? "item" : "items"}{" "}
                selected
              </span>
            ) : (
              <span>No items selected</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSelect} disabled={selectedCount === 0}>
              Select {selectedCount > 0 && `(${selectedCount})`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PickerFolderItemProps {
  folder: MediaFolder;
  level: number;
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
}

function PickerFolderItem({
  folder,
  level,
  activeFolderId,
  onSelect,
}: PickerFolderItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: subfolders } = useSubfolders(
    isExpanded ? folder.id : undefined
  );
  const isActive = folder.id === activeFolderId;

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-center rounded-none transition-colors hover:bg-accent",
          isActive && "bg-accent font-medium"
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-none hover-unified"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
            <FolderIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-xs">{folder.name}</span>
        </button>
      </div>

      {isExpanded && subfolders && subfolders.length > 0 && (
        <div>
          {subfolders.map(sub => (
            <PickerFolderItem
              key={sub.id}
              folder={sub}
              level={level + 1}
              activeFolderId={activeFolderId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
