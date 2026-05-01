"use client";

import type { Media } from "../media";

/**
 * Media Picker Dialog Props
 *
 * Component for selecting media from the media library within a dialog.
 * Supports both single-select and multi-select modes, with integrated upload functionality.
 *
 * @example Single-select mode (featured image picker)
 * ```tsx
 * const [open, setOpen] = useState(false);
 * const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
 *
 * <MediaPickerDialog
 *   mode="single"
 *   open={open}
 *   onOpenChange={setOpen}
 *   onSelect={(media) => {
 *     setSelectedMedia(media[0]);
 *     setOpen(false);
 *   }}
 *   accept="image/*"
 * />
 * ```
 *
 * @example Multi-select mode (gallery picker)
 * ```tsx
 * const [open, setOpen] = useState(false);
 * const [selectedMedia, setSelectedMedia] = useState<Media[]>([]);
 *
 * <MediaPickerDialog
 *   mode="multi"
 *   open={open}
 *   onOpenChange={setOpen}
 *   onSelect={(media) => {
 *     setSelectedMedia(media);
 *     setOpen(false);
 *   }}
 *   initialSelectedIds={new Set(selectedMedia.map(m => m.id))}
 * />
 * ```
 *
 * @example With file type filter (images only)
 * ```tsx
 * <MediaPickerDialog
 *   mode="single"
 *   open={open}
 *   onOpenChange={setOpen}
 *   onSelect={handleSelect}
 *   accept="image/*"
 *   title="Select Featured Image"
 * />
 * ```
 */
export interface MediaPickerDialogProps {
  /**
   * Selection mode
   * - 'single': Only one media item can be selected at a time
   * - 'multi': Multiple media items can be selected
   * @default 'single'
   */
  mode?: "single" | "multi";

  /**
   * Controls whether the dialog is open
   * Required for controlled component pattern
   */
  open: boolean;

  /**
   * Callback when dialog open state changes
   * Called when user clicks cancel, backdrop, or closes dialog
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Callback when user confirms selection
   * Receives array of selected Media items
   * - Single mode: array will have 1 item
   * - Multi mode: array will have 1+ items
   */
  onSelect: (media: Media[]) => void;

  /**
   * Optional pre-selected media IDs
   * Used to show existing selections when opening the dialog
   * Useful for editing existing content with media
   */
  initialSelectedIds?: Set<string>;

  /**
   * Optional file type filter for upload
   * Uses same format as HTML accept attribute
   * @example "image/*" - Only images
   * @example "image/*,video/*" - Images and videos
   * @example ".pdf,.doc,.docx" - Specific file extensions
   */
  accept?: string;

  /**
   * Maximum file size in bytes for uploads
   * @example 1048576 - 1MB limit
   * @example 5242880 - 5MB limit
   * @default 5242880 (5MB)
   */
  maxFileSize?: number;

  /**
   * Whether to allow uploading new files from within the dialog.
   * When false, the Upload tab will be hidden.
   * @default true
   */
  allowCreate?: boolean;

  /**
   * Optional custom dialog title
   * @default "Select Media" (single mode)
   * @default "Select Media" (multi mode)
   */
  title?: string;

  /**
   * Optional custom class name for dialog content
   */
  className?: string;
}

/**
 * Type alias for MediaPickerDialogProps
 * @see MediaPickerDialogProps
 */
export type MediaPickerDialog = MediaPickerDialogProps;
