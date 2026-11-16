/**
 * `@nextlyhq/admin/kit/media`: the media library.
 *
 * The library, its grid, card, picker and edit dialogs, and the upload dropzone
 * with the file-dropping code it brings.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/media
 */
export type { MediaLibraryView } from "../types/media";

// Media Library Components
export { MediaLibrary } from "../components/features/media-library";

export { MediaLibrarySkeleton } from "../components/features/media-library/MediaLibrarySkeleton";

export { MediaUploadDropzone } from "../components/features/media-library/MediaUploadDropzone";

export { MediaGrid } from "../components/features/media-library/MediaGrid";

export { MediaCard } from "../components/features/media-library/MediaCard";

export { MediaPickerDialog } from "../components/features/media-library/MediaPickerDialog";

export { MediaEditDialog } from "../components/features/media-library/MediaEditDialog";

// Media Library Component Types
export type { MediaLibraryProps } from "../components/features/media-library";

export type { MediaLibrarySkeletonProps } from "../components/features/media-library/MediaLibrarySkeleton";

export type { MediaUploadDropzoneProps } from "../types/ui/media-upload-dropzone";

export type { MediaGridProps } from "../types/ui/media-grid";

export type { MediaCardProps } from "../types/ui/media-card";

export type { MediaPickerDialogProps } from "../types/ui/media-picker-dialog";

export type { MediaEditDialogProps } from "../components/features/media-library/MediaEditDialog";

// Media Library Data Types
export type {
  Media,
  MediaFolder,
  MediaParams,
  MediaListResponse,
  UploadProgress,
  FileWithPreview,
  MediaUpdateInput,
  MediaType,
  MediaTypeFilter,
} from "../types/media";

// Media Library Helper Functions
export {
  getMediaType,
  formatFileSize,
  getMediaTypeBadgeVariant,
} from "../lib/media-utils";

// Media Library Constants
export {
  MEDIA_GRID_CLASSES,
  DEFAULT_MEDIA_SKELETON_COUNT,
} from "../constants/media";
