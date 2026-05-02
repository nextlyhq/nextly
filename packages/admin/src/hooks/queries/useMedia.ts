"use client";

/**
 * Media Query Hooks
 *
 * TanStack Query hooks for media library operations (fetch, upload, update, delete).
 * Follows the established pattern from useUsers.ts with proper cache invalidation
 * and optimistic updates.
 *
 * ## Query Keys
 *
 * - `["media"]` - All media list (base key for invalidation)
 * - `["media", params]` - Paginated/filtered/sorted media list
 * - `["media", mediaId]` - Single media detail
 *
 * @example
 * ```ts
 * queryClient.invalidateQueries({ queryKey: ["media"] }); // Invalidates all media queries
 * queryClient.invalidateQueries({ queryKey: ["media", mediaId] }); // Invalidates specific media
 * ```
 *
 * @see hooks/queries/useUsers.ts - Reference pattern for query hooks
 */

import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import type { BulkResponse, PerItemError } from "@admin/lib/api/response-types";
import {
  bulkDeleteMedia,
  deleteMedia,
  fetchMedia,
  getMediaById,
  updateMedia,
  uploadMedia,
  createFolder,
  getFolderById,
  listRootFolders,
  listSubfolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
  moveMediaToFolder,
} from "@admin/services/mediaApi";
import type {
  Media,
  MediaListResponse,
  MediaParams,
  MediaUpdateInput,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContentsResponse,
  FolderResponse,
} from "@admin/types/media";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Default media parameters
 */
const defaultParams: MediaParams = {
  page: 1,
  pageSize: 24, // Grid: 6 columns × 4 rows
  sortBy: "uploadedAt",
  sortOrder: "desc",
};

/**
 * useMedia - Query hook for fetching paginated media list
 *
 * Fetches media items with pagination, search, type filter, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["media", params]` - Hierarchical key for proper cache invalidation
 *
 * ## Features
 * - Automatic caching (5 minute staleTime from QueryClient config)
 * - Pagination support
 * - Search support (params.search)
 * - Type filter support (params.type: image/video/document/all)
 * - Sorting support (params.sortBy, params.sortOrder)
 * - TypeScript type safety
 * - Optional query options (e.g., enabled for conditional queries)
 *
 * @param params - Media filter parameters (pagination, search, type, sort)
 * @param options - Optional TanStack Query options (enabled, staleTime, etc.)
 * @returns TanStack Query result with media data, loading state, and error state
 *
 * @example
 * ```tsx
 * function MediaLibrary() {
 *   const { data, isLoading, error } = useMedia({
 *     page: 1,
 *     pageSize: 24,
 *     search: 'logo',
 *     type: 'image',
 *     sortBy: 'uploadedAt',
 *     sortOrder: 'desc',
 *   });
 *
 *   if (isLoading) return <MediaLibrarySkeleton />;
 *   if (error) return <Alert variant="destructive">Error: {error.message}</Alert>;
 *
 *   return (
 *     <MediaGrid>
 *       {data.data.map(media => (
 *         <MediaCard key={media.id} media={media} />
 *       ))}
 *     </MediaGrid>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useMedia(
  params?: MediaParams,
  options?: Omit<
    UseQueryOptions<MediaListResponse, Error>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery<MediaListResponse, Error>({
    queryKey: ["media", params],
    queryFn: async () => {
      return await fetchMedia(params || defaultParams);
    },
    ...options,
  });
}

/**
 * useInfiniteMedia - Infinite query hook for fetching media with infinite scroll
 *
 * Fetches media items with infinite scroll pagination. Automatically loads more
 * pages as user scrolls. Each page contains pageSize items.
 *
 * ## Query Key Structure
 * `["media-infinite", params]` - Separate key from useMedia to avoid conflicts
 *
 * ## Features
 * - Infinite scroll pagination
 * - Automatic page management
 * - Search and filter support
 * - Sorting support
 * - Deduplication of items across pages
 * - TypeScript type safety
 *
 * @param params - Media filter parameters (search, type, sort, pageSize)
 * @returns TanStack InfiniteQuery result with pages of media data
 *
 * @example
 * ```tsx
 * function MediaLibrary() {
 *   const {
 *     data,
 *     isLoading,
 *     error,
 *     fetchNextPage,
 *     hasNextPage,
 *     isFetchingNextPage,
 *   } = useInfiniteMedia({
 *     pageSize: 20,
 *     search: 'logo',
 *     type: 'image',
 *     sortBy: 'uploadedAt',
 *     sortOrder: 'desc',
 *   });
 *
 *   // Flatten all pages into single array
 *   const allMedia = data?.pages.flatMap(page => page.data) ?? [];
 *
 *   return (
 *     <div>
 *       <MediaGrid media={allMedia} />
 *       {hasNextPage && (
 *         <button onClick={() => fetchNextPage()}>
 *           Load More
 *         </button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useInfiniteQuery
 */
export function useInfiniteMedia(params?: Omit<MediaParams, "page">) {
  return useInfiniteQuery<MediaListResponse, Error>({
    queryKey: ["media-infinite", params],
    queryFn: async ({ pageParam = 1 }) => {
      return await fetchMedia({
        ...defaultParams,
        ...params,
        page: pageParam as number,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more pages
      const currentPage = allPages.length;
      const pageSize = params?.pageSize || defaultParams.pageSize || 20;
      const totalPages = Math.ceil(lastPage.meta.total / pageSize);

      if (currentPage < totalPages) {
        return currentPage + 1;
      }

      return undefined; // No more pages
    },
    initialPageParam: 1,
  });
}

/**
 * useMediaItem - Query hook for fetching a single media item by ID
 *
 * Fetches a single media item's details. Only runs when mediaId is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["media", mediaId]` - Hierarchical key for single media item
 *
 * ## Features
 * - Conditional execution (only runs when mediaId exists)
 * - Automatic caching (5 minute staleTime)
 * - TypeScript type safety
 * - Error handling built-in
 *
 * @param mediaId - The ID of the media item to fetch (optional)
 * @returns TanStack Query result with media data, loading state, and error state
 *
 * @example
 * ```tsx
 * function MediaDetail({ mediaId }: { mediaId?: string }) {
 *   const { data: media, isLoading, error } = useMediaItem(mediaId);
 *
 *   if (!mediaId) return <div>No media selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert variant="destructive">Error: {error.message}</Alert>;
 *   if (!media) return <div>Media not found</div>;
 *
 *   return (
 *     <div>
 *       <img src={media.url} alt={media.altText || media.filename} />
 *       <p>{media.filename}</p>
 *       <p>{formatFileSize(media.size)}</p>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useMediaItem(mediaId?: string) {
  return useQuery<Media, Error>({
    queryKey: ["media", mediaId],
    queryFn: async () => {
      if (!mediaId) {
        throw new Error("Media ID is required");
      }
      return await getMediaById(mediaId);
    },
    enabled: !!mediaId,
  });
}

/**
 * useUploadMedia - Mutation hook for uploading a single media file
 *
 * Uploads a file with progress tracking and automatically invalidates the media list cache.
 * Returns the uploaded Media object for immediate use.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["media"]` query keys on success (can be disabled via options)
 *
 * ## Features
 * - Progress tracking via onProgress callback
 * - Returns uploaded Media object
 * - Automatic cache invalidation (optional)
 * - Loading state management via isPending
 * - Error handling
 * - TypeScript type safety
 *
 * @param options - Optional configuration object
 * @param options.disableAutoInvalidate - If true, disables automatic cache invalidation (default: false)
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example Basic usage with auto-invalidation
 * ```tsx
 * function UploadButton({ file }: { file: File }) {
 *   const { mutate: uploadMedia, isPending } = useUploadMedia();
 *   const [progress, setProgress] = React.useState(0);
 *
 *   const handleUpload = () => {
 *     uploadMedia(
 *       { file, onProgress: setProgress },
 *       {
 *         onSuccess: (media) => {
 *           toast.success(`Uploaded: ${media.filename}`);
 *           setProgress(0);
 *         },
 *         onError: (error) => {
 *           toast.error(`Upload failed: ${error.message}`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <div>
 *       <Button onClick={handleUpload} disabled={isPending}>
 *         {isPending ? 'Uploading...' : 'Upload'}
 *       </Button>
 *       {isPending && <Progress value={progress} />}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example Batch uploads with manual cache invalidation
 * ```tsx
 * function BatchUpload({ files }: { files: File[] }) {
 *   const { mutateAsync } = useUploadMedia({ disableAutoInvalidate: true });
 *   const queryClient = useQueryClient();
 *
 *   const handleBatchUpload = async () => {
 *     // Upload all files
 *     await Promise.all(files.map(file => mutateAsync({ file })));
 *
 *     // Invalidate cache once after all uploads
 *     await queryClient.invalidateQueries({ queryKey: ["media"] });
 *     toast.success('All files uploaded!');
 *   };
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useUploadMedia(options?: { disableAutoInvalidate?: boolean }) {
  const queryClient = useQueryClient();
  const shouldInvalidate = !options?.disableAutoInvalidate;

  return useMutation<
    Media,
    Error,
    {
      file: File;
      onProgress?: (progress: number) => void;
      folderId?: string | null;
    }
  >({
    mutationFn: async ({ file, onProgress, folderId }) => {
      return await uploadMedia(file, onProgress, folderId);
    },
    onSuccess: async () => {
      if (shouldInvalidate) {
        // Invalidate all media queries to refetch data
        // Use await to ensure cache is properly invalidated before continuing
        await queryClient.invalidateQueries({ queryKey: ["media"] });
        // Invalidate dashboard caches so media stats refresh immediately
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
}

/**
 * useUpdateMedia - Mutation hook for updating media metadata
 *
 * Updates media metadata (filename, altText, caption, tags) and automatically
 * invalidates relevant caches.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["media"]` - All media list queries
 * - `["media", mediaId]` - Specific media detail query
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management via isPending
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditMediaForm({ mediaId }: { mediaId: string }) {
 *   const { data: media } = useMediaItem(mediaId);
 *   const { mutate: updateMedia, isPending } = useUpdateMedia();
 *
 *   const handleSubmit = (updates: MediaUpdateInput) => {
 *     updateMedia(
 *       { mediaId, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Media updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update: ${error.message}`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Input defaultValue={media?.filename} name="filename" />
 *       <Input defaultValue={media?.altText || ''} name="altText" />
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Saving...' : 'Save Changes'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useUpdateMedia() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { mediaId: string; updates: MediaUpdateInput }
  >({
    mutationFn: async ({ mediaId, updates }) => {
      return await updateMedia(mediaId, updates);
    },
    onSuccess: () => {
      // Remove all cached media data so navigating to any folder refetches fresh data
      queryClient.removeQueries({ queryKey: ["media"] });
      queryClient.removeQueries({ queryKey: ["media-infinite"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

/**
 * useDeleteMedia - Mutation hook for deleting a media item
 *
 * Deletes a media item and automatically invalidates the media list cache.
 * Provides loading state for UI feedback.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["media"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management via isPending
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteMediaButton({ mediaId }: { mediaId: string }) {
 *   const { mutate: deleteMedia, isPending } = useDeleteMedia();
 *
 *   const handleDelete = () => {
 *     if (confirm('Are you sure you want to delete this media?')) {
 *       deleteMedia(mediaId, {
 *         onSuccess: () => {
 *           toast.success('Media deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete: ${error.message}`);
 *         },
 *       });
 *     }
 *   };
 *
 *   return (
 *     <Button
 *       variant="destructive"
 *       onClick={handleDelete}
 *       disabled={isPending}
 *     >
 *       {isPending ? 'Deleting...' : 'Delete'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeleteMedia() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (mediaId: string) => {
      return await deleteMedia(mediaId);
    },
    onSuccess: () => {
      // Invalidate all media queries to refetch data
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}

/**
 * useBulkDeleteMedia - Hook for deleting multiple media items in parallel
 *
 * Deletes multiple media items simultaneously using `Promise.allSettled()` for
 * parallel execution. Handles partial failures gracefully (some deletions succeed, some fail).
 *
 * ## Features
 * - ✅ Parallel execution for performance
 * - ✅ Partial failure handling (detailed error reporting)
 * - ✅ Automatic cache invalidation after completion
 * - ✅ Detailed result tracking (succeeded/failed counts, failed IDs for retry)
 * - ✅ Loading state management via isPending
 *
 * ## Use Cases
 * - Bulk delete selected media
 * - Cleanup unused media
 * - Administrative media management
 *
 * ## Safety Considerations
 * - **Always show confirmation dialog** before calling this hook
 * - Deletion is permanent and cannot be undone
 *
 * ## Architecture
 * ```
 * useBulkDeleteMedia (Entity-Specific)
 *   ↓ wraps
 * useBulkMutation (Generic)
 *   ↓ uses
 * Promise.allSettled()
 * ```
 *
 * @returns Bulk mutation hook with mutate function and loading state
 *
 * @example With confirmation dialog
 * ```tsx
 * function BulkDeleteButton({ mediaIds }: { mediaIds: string[] }) {
 *   const { mutate: bulkDeleteMedia, isPending } = useBulkDeleteMedia();
 *   const [dialogOpen, setDialogOpen] = useState(false);
 *
 *   const handleConfirmDelete = () => {
 *     bulkDeleteMedia(
 *       mediaIds,
 *       undefined,
 *       {
 *         onSuccess: (result) => {
 *           toast.success(`${result.succeeded} media items deleted`);
 *           setDialogOpen(false);
 *         },
 *         onError: (result) => {
 *           toast.error(`${result.failed} items failed to delete`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <>
 *       <Button variant="destructive" onClick={() => setDialogOpen(true)}>
 *         Delete {mediaIds.length} Items
 *       </Button>
 *       <BulkDeleteDialog
 *         open={dialogOpen}
 *         onOpenChange={setDialogOpen}
 *         mediaIds={mediaIds}
 *         onConfirm={handleConfirmDelete}
 *         isLoading={isPending}
 *       />
 *     </>
 *   );
 * }
 * ```
 *
 * @see {@link useBulkMutation} - Generic bulk mutation hook
 * @see {@link useDeleteMedia} - Single media deletion hook
 */
/**
 * Options for useBulkDeleteMedia hook (Phase 4.5).
 *
 * Surface mirrors `UseBulkDeleteEntriesOptions` so consumers see a
 * consistent shape across entity-specific bulk hooks.
 */
export interface UseBulkDeleteMediaOptions {
  /** Fired after the bulk request completes (success OR partial failure). */
  onComplete?: (result: {
    succeeded: number;
    failed: number;
    total: number;
    message: string;
    items: Array<{ id: string }>;
    errors: PerItemError[];
  }) => void;
  /**
   * Fired when the request itself rejected (network error, 4xx, 5xx).
   * Per-item failures inside a 200 response do NOT trigger this; use
   * `onComplete` to inspect `result.errors` for partial failures.
   */
  onError?: (error: Error) => void;
  /** Whether to show a toast notification with `result.message` (default: true). */
  showToast?: boolean;
}

/**
 * Bulk-delete multiple media files in a single round-trip (Phase 4.5).
 *
 * Hits `DELETE /api/media/bulk` (server `media-bulk.ts`). Server runs
 * per-id deletes concurrently via Promise.allSettled with full
 * access-control + storage-cleanup pipeline. Partial failures land in
 * `result.errors` with structured `{ id, code, message }`.
 *
 * Pre-Phase-4.5: this hook used `useBulkMutation` to fan out N parallel
 * single-item DELETE calls. The new pattern is a single round-trip to
 * the server's bulk endpoint; see useBulkEntries.ts for the same pattern
 * applied to collection entries.
 */
export function useBulkDeleteMedia(options: UseBulkDeleteMediaOptions = {}) {
  const { onComplete, onError, showToast = true } = options;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mediaIds: string[]) => {
      return bulkDeleteMedia(mediaIds);
    },
    onSuccess: (response: BulkResponse<{ id: string }>) => {
      // Invalidate media cache so list views reflect the deletions.
      void queryClient.invalidateQueries({ queryKey: ["media"] });

      const succeeded = response.items.length;
      const failed = response.errors.length;

      if (showToast) {
        if (failed > 0) {
          toast.warning(response.message);
        } else {
          toast.success(response.message);
        }
      }

      onComplete?.({
        succeeded,
        failed,
        total: succeeded + failed,
        message: response.message,
        items: response.items,
        errors: response.errors,
      });
    },
    onError: error => {
      if (showToast) {
        toast.error(
          error instanceof Error ? error.message : "Bulk delete failed."
        );
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });
}

/**
 * useBulkUpdateMedia - Bulk mutation hook for updating multiple media items
 *
 * Executes parallel update operations for multiple media items using Promise.allSettled().
 * Allows partial failures where some updates succeed while others fail.
 * Automatically invalidates the media cache after all operations complete.
 *
 * ## Features
 * - ✅ Parallel execution with Promise.allSettled()
 * - ✅ Partial failure handling (some succeed, some fail)
 * - ✅ Detailed results with success/failure counts
 * - ✅ Automatic cache invalidation after completion
 * - ✅ TypeScript type safety
 * - ✅ Accepts MediaUpdateInput via context parameter
 *
 * ## Architecture
 *
 * ```
 * useBulkUpdateMedia (Entity-Specific)
 *   ↓
 * useBulkMutation (Generic Hook)
 *   ↓
 * Promise.allSettled() (Parallel Execution)
 * ```
 *
 * ## Result Structure
 *
 * ```ts
 * {
 *   succeeded: 8,        // Number of successful updates
 *   failed: 2,           // Number of failed updates
 *   total: 10,           // Total media items attempted
 *   succeededIds: [...], // IDs of successfully updated items
 *   failedIds: [...],    // IDs of items that failed to update
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates `["media"]` query keys after all operations complete
 *
 * ## Use Cases
 * - Bulk update alt text for accessibility
 * - Bulk add tags for organization
 * - Bulk update captions
 * - Bulk rename files
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Bulk update alt text
 * ```tsx
 * function BulkUpdateAltText() {
 *   const { mutate: bulkUpdate, isPending } = useBulkUpdateMedia();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkUpdate = async () => {
 *     const updates: MediaUpdateInput = {
 *       altText: 'Updated via bulk operation',
 *     };
 *
 *     const result = await bulkUpdate(selectedIds, updates);
 *
 *     if (result.failed > 0) {
 *       toast.error(`${result.failed} media items failed to update`);
 *     }
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} media items updated`);
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkUpdate} disabled={isPending}>
 *       {isPending ? 'Updating...' : `Update ${selectedIds.length} Items`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example Bulk add tags with progress tracking
 * ```tsx
 * const [progress, setProgress] = useState(0);
 * const { mutate: bulkUpdate } = useBulkUpdateMedia();
 *
 * bulkUpdate(['id1', 'id2', 'id3'], { tags: ['new-tag'] }, {
 *   onItemComplete: (itemResult) => {
 *     setProgress(prev => prev + 1);
 *     console.log(`Media ${itemResult.id}: ${itemResult.status}`);
 *   },
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} media items tagged`);
 *   },
 *   onError: (result) => {
 *     toast.error(`${result.failed} items failed`);
 *   },
 * });
 * ```
 *
 * @example Bulk update with individual error handling
 * ```tsx
 * const { mutate: bulkUpdate } = useBulkUpdateMedia();
 *
 * bulkUpdate(mediaIds, updates, {
 *   onComplete: (result) => {
 *     // Log failed items for debugging
 *     result.results
 *       .filter(r => r.status === 'rejected')
 *       .forEach(r => {
 *         console.error(`Failed to update ${r.id}:`, r.error);
 *       });
 *
 *     // Show summary
 *     if (result.failed > 0) {
 *       toast.error(
 *         `${result.failed} of ${result.total} updates failed. Check console for details.`
 *       );
 *     }
 *   },
 * });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useUpdateMedia - Single media update hook
 * @see useBulkDeleteMedia - Similar pattern for deletion
 */
export function useBulkUpdateMedia() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, MediaUpdateInput>({
    mutationFn: async (mediaId: string, updates: MediaUpdateInput) => {
      await updateMedia(mediaId, updates);
    },
    defaultOptions: {
      onComplete: () => {
        // Invalidate media cache after all mutations complete
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      },
    },
  });
}

// ========================================
// FOLDER QUERY HOOKS
// ========================================

/**
 * useRootFolders - Query hook for fetching root-level folders
 *
 * @returns TanStack Query result with root folders
 */
export function useRootFolders() {
  return useQuery<MediaFolder[], Error>({
    queryKey: ["folders", "root"],
    queryFn: async () => {
      return await listRootFolders();
    },
  });
}

/**
 * useFolderById - Query hook for fetching a single folder with its breadcrumb
 * path. Useful when you need to know a folder's ancestors (e.g. to auto-expand
 * a tree picker to reveal the selection).
 *
 * @param folderId - Folder ID (undefined disables the query)
 * @returns TanStack Query result with folder + breadcrumbs
 */
export function useFolderById(folderId?: string | null) {
  return useQuery<FolderResponse["data"], Error>({
    queryKey: ["folders", "byId", folderId],
    queryFn: async () => {
      if (!folderId) throw new Error("Folder ID is required");
      return await getFolderById(folderId);
    },
    enabled: !!folderId,
  });
}

/**
 * useSubfolders - Query hook for fetching subfolders within a parent folder
 *
 * @param parentId - Parent folder ID
 * @returns TanStack Query result with subfolders
 */
export function useSubfolders(parentId?: string) {
  return useQuery<MediaFolder[], Error>({
    queryKey: ["folders", "subfolders", parentId],
    queryFn: async () => {
      if (!parentId) throw new Error("Parent ID is required");
      return await listSubfolders(parentId);
    },
    enabled: !!parentId,
  });
}

/**
 * useFolderContents - Query hook for fetching folder contents (subfolders + media)
 *
 * @param folderId - Folder ID (null for root)
 * @returns TanStack Query result with folder contents
 */
export function useFolderContents(folderId: string | null) {
  return useQuery<FolderContentsResponse["data"], Error>({
    queryKey: ["folders", "contents", folderId],
    queryFn: async () => {
      return await getFolderContents(folderId);
    },
  });
}

/**
 * useCreateFolder - Mutation hook for creating a new folder
 *
 * @returns TanStack Mutation result
 */
export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation<MediaFolder, Error, CreateFolderInput>({
    mutationFn: async (input: CreateFolderInput) => {
      return await createFolder(input);
    },
    onSuccess: () => {
      // Invalidate folder queries to refetch
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

/**
 * useUpdateFolder - Mutation hook for updating folder metadata
 *
 * @returns TanStack Mutation result
 */
export function useUpdateFolder() {
  const queryClient = useQueryClient();

  return useMutation<
    MediaFolder,
    Error,
    { folderId: string; updates: UpdateFolderInput }
  >({
    mutationFn: async ({ folderId, updates }) => {
      return await updateFolder(folderId, updates);
    },
    onSuccess: () => {
      // Invalidate folder queries to refetch
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

/**
 * useDeleteFolder - Mutation hook for deleting a folder
 *
 * @returns TanStack Mutation result
 */
export function useDeleteFolder() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { folderId: string; deleteContents: boolean }
  >({
    mutationFn: async ({ folderId, deleteContents }) => {
      return await deleteFolder(folderId, deleteContents);
    },
    onSuccess: () => {
      // Invalidate folder, media, and infinite queries (folder deletion removes media)
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["media-infinite"] });
    },
  });
}

/**
 * useMoveMediaToFolder - Mutation hook for moving media to a folder
 *
 * @returns TanStack Mutation result
 */
export function useMoveMediaToFolder() {
  const queryClient = useQueryClient();

  return useMutation<
    Media | null,
    Error,
    { mediaId: string; folderId: string | null }
  >({
    mutationFn: async ({ mediaId, folderId }) => {
      return await moveMediaToFolder(mediaId, folderId);
    },
    onSuccess: () => {
      // Remove all cached media/folder data so navigating to any folder refetches fresh data
      queryClient.removeQueries({ queryKey: ["media"] });
      queryClient.removeQueries({ queryKey: ["media-infinite"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}
