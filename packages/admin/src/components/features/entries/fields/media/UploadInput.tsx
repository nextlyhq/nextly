/**
 * Upload Input Component
 *
 * A media selection input that integrates with the MediaPickerDialog.
 * Allows users to select from existing media or upload new files.
 *
 * @module components/entries/fields/media/UploadInput
 * @since 1.0.0
 */

import type { UploadFieldConfig } from "@revnixhq/nextly/config";
import { Button } from "@revnixhq/ui";
import { useState, useCallback } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { MediaEditDialog } from "@admin/components/features/media-library/MediaEditDialog";
import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import { Image } from "@admin/components/icons";
import * as useMediaHooks from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import { UploadPreview, type UploadedFile } from "./UploadPreview";

// ============================================================
// Types
// ============================================================

export interface UploadInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   */
  field: UploadFieldConfig;

  /**
   * React Hook Form control object.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Normalize form value to array of UploadedFile.
 * Handles string IDs, populated objects, polymorphic values, and stringified JSON.
 */
function normalizeValue(value: unknown): UploadedFile[] {
  if (!value) return [];

  // Handle stringified JSON array or object (possibly double-stringified)
  if (typeof value === "string") {
    let current: unknown = value;

    // Keep parsing JSON strings until we get a non-string or parsing fails
    while (
      typeof current === "string" &&
      (current.startsWith("[") || current.startsWith("{"))
    ) {
      try {
        current = JSON.parse(current);
      } catch {
        break;
      }
    }

    // If we successfully parsed to array or object, normalize it
    if (Array.isArray(current)) {
      return current.map(normalizeItem).filter(Boolean) as UploadedFile[];
    }
    if (typeof current === "object" && current !== null) {
      const normalized = normalizeItem(current);
      return normalized ? [normalized] : [];
    }

    // Still a string - treat as single ID
    const normalized = normalizeItem(current);
    return normalized ? [normalized] : [];
  }

  // Handle array of values
  if (Array.isArray(value)) {
    return value.map(normalizeItem).filter(Boolean) as UploadedFile[];
  }

  // Handle single object value
  const normalized = normalizeItem(value);
  return normalized ? [normalized] : [];
}

/**
 * Normalize a single value item.
 * Handles various data formats from the API including camelCase and snake_case properties.
 */
function normalizeItem(item: unknown): UploadedFile | null {
  if (!item) return null;

  // String value - could be ID only or JSON stringified object (possibly double-stringified)
  if (typeof item === "string") {
    let current: unknown = item;

    // Try to parse JSON (handle potentially double-stringified data)
    // Keep parsing until we get a non-string result or parsing fails
    while (
      typeof current === "string" &&
      (current.startsWith("{") || current.startsWith("["))
    ) {
      try {
        current = JSON.parse(current);
      } catch {
        // Not valid JSON, break out of loop
        break;
      }
    }

    // If we successfully parsed to an object, normalize it
    if (typeof current === "object" && current !== null) {
      // Recursively normalize the parsed object
      return normalizeItem(current);
    }

    // Still a string - check if it looks like a valid ID (UUID format or similar)
    // If it contains JSON-like characters, it's likely corrupted data - skip it
    if (typeof current === "string") {
      const str = current;
      if (str.includes("{") || str.includes("}") || str.includes('"')) {
        // Corrupted/partial JSON data - skip
        return null;
      }
      // Plain string ID - the upload field value is not populated
      return {
        id: str,
        filename: str,
      };
    }

    return null;
  }

  // Populated object
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;

    // Polymorphic value { relationTo, value }
    if ("relationTo" in obj && "value" in obj) {
      const innerValue = obj.value;
      if (typeof innerValue === "string") {
        return {
          id: innerValue,
          filename: innerValue,
        };
      }
      if (typeof innerValue === "object" && innerValue !== null) {
        return normalizeItem(innerValue);
      }
      return null;
    }

    // Regular populated object
    // Handle both camelCase and snake_case property names from API
    if ("id" in obj) {
      // Helper to safely get string property
      const getString = (value: unknown): string | undefined => {
        if (typeof value === "string" && value.length > 0) return value;
        return undefined;
      };

      // Helper to safely get number property
      const getNumber = (value: unknown): number | undefined => {
        if (typeof value === "number") return value;
        return undefined;
      };

      // Get filename from various possible properties (ensure it's a string, not an object)
      const filename =
        getString(obj.filename) ||
        getString(obj.originalFilename) ||
        getString(obj.original_filename) ||
        String(obj.id);

      // Get URL - try multiple property names
      const url = getString(obj.url);

      // Get thumbnail URL - try multiple property names
      const thumbnailUrl =
        getString(obj.thumbnailUrl) ||
        getString(obj.thumbnail_url) ||
        getString(obj.thumbnailURL);

      // Get MIME type - try multiple property names
      const mimeType = getString(obj.mimeType) || getString(obj.mime_type);

      return {
        id: String(obj.id),
        filename,
        url,
        thumbnailUrl,
        mimeType,
        filesize:
          getNumber(obj.filesize) ||
          getNumber(obj.file_size) ||
          getNumber(obj.size),
        width: getNumber(obj.width),
        height: getNumber(obj.height),
        altText: getString(obj.altText) || getString(obj.alt_text),
        title: getString(obj.title),
        caption: getString(obj.caption),
        tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : undefined,
        folderId: getString(obj.folderId) || getString(obj.folder_id) || null,
      };
    }
  }

  return null;
}

/**
 * Convert Media object to UploadedFile format.
 */
function mediaToUploadedFile(media: Media): UploadedFile {
  return {
    id: media.id,
    filename: media.filename,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl ?? undefined,
    mimeType: media.mimeType,
    filesize: media.size,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    altText: media.altText ?? undefined,
    caption: media.caption ?? undefined,
    tags: media.tags ?? undefined,
    folderId: media.folderId ?? null,
  };
}

// ============================================================
// Component
// ============================================================

/**
 * UploadInput provides a media selection field with MediaPickerDialog integration.
 *
 * Features:
 * - Opens MediaPickerDialog for browsing and selecting media
 * - Supports uploading new files within the dialog (when allowCreate is true)
 * - Single and multiple file support (hasMany)
 * - Preview cards for selected files
 * - React Hook Form integration
 * - Respects field configuration (mimeTypes, allowCreate, hasMany, maxRows)
 *
 * Note: This component renders only the selection button and previews.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={uploadField} error={errors.image?.message}>
 *   <UploadInput
 *     name="image"
 *     field={uploadField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 */
export function UploadInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: UploadInputProps<TFieldValues>) {
  // Media picker dialog state
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Local display cache for immediate preview after selection
  // This holds full media objects for display while the form value only stores IDs
  const [displayFiles, setDisplayFiles] = useState<UploadedFile[]>([]);

  // Editing state
  const [editingMedia, setEditingMedia] = useState<Media | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { mutateAsync: updateMediaAction } = useMediaHooks.useUpdateMedia();

  // React Hook Form integration
  const {
    field: { value, onChange },
  } = useController({
    name,
    control,
    defaultValue: (field.hasMany
      ? []
      : null) as TFieldValues[Path<TFieldValues>],
  });

  // Get configuration values
  const allowCreate = field.admin?.allowCreate !== false;
  const mimeTypes = field.mimeTypes;

  // Normalize current value to array of files for display
  // This handles both:
  // 1. Populated objects from API (when editing existing entries)
  // 2. Plain IDs (when form value is just IDs)
  // 3. Local display cache (for immediate preview after selection)
  const normalizedFromValue = normalizeValue(value);

  // Use displayFiles if available and IDs match, otherwise use normalized value
  // This ensures we show full media info immediately after selection
  const files =
    displayFiles.length > 0 &&
    displayFiles.every(
      df =>
        normalizedFromValue.some(nf => nf.id === df.id) ||
        (Array.isArray(value) ? value.includes(df.id) : value === df.id)
    )
      ? displayFiles
      : normalizedFromValue;

  // Check if more files can be added
  const canAddMore = field.hasMany
    ? !field.maxRows || files.length < field.maxRows
    : files.length === 0;

  // Get initial selected IDs for the picker dialog
  const initialSelectedIds = new Set(files.map(f => f.id));

  /**
   * Handle media selection from the picker dialog.
   *
   * IMPORTANT: We store only media IDs in the form value, not full objects.
   * The database stores upload fields as ID references (single ID or array of IDs).
   * The normalizeValue function handles displaying data by working with both
   * populated objects (from API reads) and plain IDs.
   *
   * We also update the local files state with full media data for immediate display
   * without waiting for a refetch.
   */
  const handleMediaSelect = useCallback(
    (selectedMedia: Media[]) => {
      if (selectedMedia.length === 0) {
        // User deselected everything in multi-mode, or cancelled
        if (field.hasMany) {
          onChange([] as TFieldValues[Path<TFieldValues>]);
        }
        setIsPickerOpen(false);
        return;
      }

      if (field.hasMany) {
        // For hasMany, store array of media IDs
        // Respect maxRows limit
        const limitedMedia = field.maxRows
          ? selectedMedia.slice(0, field.maxRows)
          : selectedMedia;

        // Store only IDs in the form (this is what gets saved to DB)
        const ids = limitedMedia.map(m => m.id);
        onChange(ids as TFieldValues[Path<TFieldValues>]);

        // Update local display cache with full media objects for immediate preview
        setDisplayFiles(limitedMedia.map(mediaToUploadedFile));
      } else {
        // For single selection, store just the ID
        const mediaId = selectedMedia[0].id;
        onChange(mediaId as TFieldValues[Path<TFieldValues>]);

        // Update local display cache
        setDisplayFiles([mediaToUploadedFile(selectedMedia[0])]);
      }

      setIsPickerOpen(false);
    },
    [field.hasMany, field.maxRows, onChange]
  );

  /**
   * Handle file removal.
   * Stores only IDs in the form value.
   */
  const handleRemove = useCallback(
    (fileId: string) => {
      if (field.hasMany) {
        // Filter out the removed file
        const updatedFiles = files.filter(f => f.id !== fileId);
        // Store only IDs in form
        const ids = updatedFiles.map(f => f.id);
        onChange(ids as TFieldValues[Path<TFieldValues>]);
        // Update display cache
        setDisplayFiles(updatedFiles);
      } else {
        onChange(null as TFieldValues[Path<TFieldValues>]);
        setDisplayFiles([]);
      }
    },
    [field.hasMany, files, onChange]
  );

  /**
   * Handle edit request for a file.
   */
  const handleEdit = useCallback((file: UploadedFile) => {
    // Create a Media-compatible object for the dialog
    const media: Media = {
      id: file.id,
      filename: file.filename,
      originalFilename: file.filename,
      mimeType: file.mimeType || "image/jpeg",
      size: file.filesize || 0,
      url: file.url || "",
      thumbnailUrl: file.thumbnailUrl,
      width: file.width,
      height: file.height,
      altText: file.altText,
      caption: file.caption,
      tags: file.tags,
      folderId: file.folderId,
      uploadedBy: "",
      uploadedAt: new Date(),
      updatedAt: new Date(),
    };
    setEditingMedia(media);
    setIsEditDialogOpen(true);
  }, []);

  /**
   * Handle metadata save.
   */
  const handleSaveMetadata = async (updates: MediaUpdateInput) => {
    if (!editingMedia) return;

    try {
      await updateMediaAction({
        mediaId: editingMedia.id,
        updates,
      });

      // Update local display cache
      setDisplayFiles(prev =>
        prev.map(f => (f.id === editingMedia.id ? { ...f, ...updates } : f))
      );
    } catch (error) {
      console.error("Failed to update media metadata:", error);
      throw error;
    }
  };

  /**
   * Open the media picker dialog.
   */
  const handleOpenPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Existing files */}
      {files.length > 0 && (
        <div
          className={cn(
            "grid gap-4",
            field.hasMany
              ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
              : "grid-cols-1 max-w-[200px]"
          )}
        >
          {files.map(file => (
            <UploadPreview
              key={file.id}
              file={file}
              onRemove={() => handleRemove(file.id)}
              onEdit={() => handleEdit(file)}
              disabled={disabled || readOnly}
            />
          ))}
        </div>
      )}

      {/* Select Media Button */}
      {canAddMore && !disabled && !readOnly && (
        <Button
          type="button"
          variant="outline"
          onClick={handleOpenPicker}
          className="gap-2"
        >
          <Image className="h-4 w-4" />
          {files.length === 0 ? "Select Media" : "Add More Media"}
        </Button>
      )}

      {/* Max files reached message */}
      {!canAddMore && field.hasMany && (
        <p className="text-sm text-muted-foreground">
          Maximum number of files reached ({field.maxRows})
        </p>
      )}
      {/* Media Picker Dialog */}
      <MediaPickerDialog
        mode={field.hasMany ? "multi" : "single"}
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        onSelect={handleMediaSelect}
        initialSelectedIds={initialSelectedIds}
        accept={mimeTypes}
        maxFileSize={field.maxFileSize}
        allowCreate={allowCreate}
      />

      {/* Media Edit Dialog */}
      <MediaEditDialog
        open={isEditDialogOpen}
        media={editingMedia}
        onOpenChange={setIsEditDialogOpen}
        onSave={handleSaveMetadata}
      />
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
