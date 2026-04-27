/**
 * useEntryPreview Hook
 *
 * Provides preview URL generation and preview opening functionality
 * for entry forms. Supports both saved entries and unsaved changes
 * via session storage.
 *
 * @module hooks/useEntryPreview
 * @since 1.0.0
 */

import { useCallback, useMemo } from "react";

import {
  storePreviewData,
  generatePreviewUrlWithData,
} from "@admin/lib/preview/preview-data";

// ============================================================================
// Types
// ============================================================================

/**
 * Preview configuration from collection admin config.
 * Supports both function-based (code-first) and template-based (UI) configs.
 */
export interface PreviewConfig {
  /**
   * Function to generate preview URL from entry data.
   * Used by code-first collections.
   */
  url?: (entry: Record<string, unknown>) => string | null;

  /**
   * URL template with {fieldName} placeholders.
   * Used by UI-created collections.
   */
  urlTemplate?: string;

  /**
   * Whether to open preview in a new tab.
   * @default true
   */
  openInNewTab?: boolean;

  /**
   * Custom label for the preview button.
   * @default "Preview"
   */
  label?: string;
}

/**
 * Collection configuration required for preview functionality.
 */
export interface PreviewCollection {
  /** Collection slug/name */
  name: string;
  /** Admin configuration including preview settings */
  admin?: {
    preview?: PreviewConfig;
  };
}

/**
 * Options for the useEntryPreview hook.
 */
export interface UseEntryPreviewOptions {
  /** Collection with preview configuration */
  collection: PreviewCollection;
  /** Existing entry data (for edit mode) */
  entry?: Record<string, unknown> | null;
  /**
   * Function to get current form values (for unsaved changes).
   * Called when opening preview to get the latest form state.
   */
  getFormValues?: () => Record<string, unknown>;
}

/**
 * Return type for useEntryPreview hook.
 */
export interface UseEntryPreviewResult {
  /** Whether preview is available for this collection */
  isPreviewAvailable: boolean;
  /** Current preview URL based on saved entry (null if not available) */
  previewUrl: string | null;
  /** Open the preview (uses unsaved data if available) */
  openPreview: () => void;
  /** Get preview URL for specific data */
  getPreviewUrl: (data: Record<string, unknown>) => string | null;
  /** Label for the preview button */
  label: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Interpolate URL template with entry data.
 *
 * Replaces {fieldName} placeholders with actual field values.
 * Returns null if any required field is missing.
 *
 * @param template - URL template with {fieldName} placeholders
 * @param data - Entry data to interpolate
 * @returns Interpolated URL or null if interpolation fails
 */
function interpolateUrlTemplate(
  template: string,
  data: Record<string, unknown>
): string | null {
  try {
    let result = template;
    const placeholders = template.match(/\{(\w+)\}/g) || [];

    for (const placeholder of placeholders) {
      const fieldName = placeholder.slice(1, -1); // Remove { and }
      const value = data[fieldName];

      // If a required field is missing/null/undefined, can't generate URL
      if (value === null || value === undefined || value === "") {
        return null;
      }

      result = result.replace(placeholder, String(value));
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL to be absolute if it's relative.
 *
 * @param url - URL that may be relative or absolute
 * @returns Absolute URL
 */
function normalizeUrl(url: string): string {
  if (url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useEntryPreview - Preview URL generation for entry forms
 *
 * Generates preview URLs based on collection configuration and entry data.
 * Supports:
 * - Function-based URL generation (code-first collections)
 * - Template-based URL generation (UI-created collections)
 * - Previewing unsaved changes via session storage
 *
 * @example Basic usage
 * ```tsx
 * const { isPreviewAvailable, openPreview, label } = useEntryPreview({
 *   collection,
 *   entry,
 *   getFormValues: () => form.getValues(),
 * });
 *
 * {isPreviewAvailable && (
 *   <Button onClick={openPreview}>
 *     <Eye className="mr-2 h-4 w-4" />
 *     {label}
 *   </Button>
 * )}
 * ```
 *
 * @example Check preview URL availability
 * ```tsx
 * const { previewUrl, isPreviewAvailable } = useEntryPreview({
 *   collection,
 *   entry,
 * });
 *
 * // previewUrl is null if:
 * // - Collection has no preview config
 * // - Entry data is insufficient (e.g., missing slug)
 * ```
 */
export function useEntryPreview({
  collection,
  entry,
  getFormValues,
}: UseEntryPreviewOptions): UseEntryPreviewResult {
  const previewConfig = collection.admin?.preview;

  // Check if preview is configured
  const isPreviewAvailable = useMemo(() => {
    if (!previewConfig) return false;
    return !!(previewConfig.url || previewConfig.urlTemplate);
  }, [previewConfig]);

  /**
   * Generate preview URL for given data.
   * Tries function-based first, then template-based.
   */
  const getPreviewUrl = useCallback(
    (data: Record<string, unknown>): string | null => {
      if (!previewConfig) return null;

      try {
        // Try function-based URL first (code-first collections)
        if (previewConfig.url) {
          const url = previewConfig.url(data);
          return url ? normalizeUrl(url) : null;
        }

        // Try template-based URL (UI collections)
        if (previewConfig.urlTemplate) {
          const url = interpolateUrlTemplate(previewConfig.urlTemplate, data);
          return url ? normalizeUrl(url) : null;
        }

        return null;
      } catch (error) {
        console.error("Failed to generate preview URL:", error);
        return null;
      }
    },
    [previewConfig]
  );

  /**
   * Preview URL for the current saved entry.
   */
  const previewUrl = useMemo(() => {
    if (!entry) return null;
    return getPreviewUrl(entry);
  }, [entry, getPreviewUrl]);

  /**
   * Open preview in a new tab/window.
   * Uses unsaved form data if available via getFormValues.
   */
  const openPreview = useCallback(() => {
    // Get the data to preview (unsaved form values or saved entry)
    const unsavedData = getFormValues?.();
    const dataToPreview = unsavedData ? { ...entry, ...unsavedData } : entry;

    if (!dataToPreview) {
      console.warn("No data available for preview");
      return;
    }

    // Generate base preview URL
    let url = getPreviewUrl(dataToPreview);
    if (!url) {
      console.warn("Could not generate preview URL");
      return;
    }

    // If there's unsaved data, store it and append preview key
    if (unsavedData) {
      const entryId = entry?.id as string | undefined;
      const previewKey = storePreviewData(
        collection.name,
        entryId,
        dataToPreview
      );
      url = generatePreviewUrlWithData(url, previewKey);
    }

    // Open the preview
    const openInNewTab = previewConfig?.openInNewTab !== false;
    if (openInNewTab) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = url;
    }
  }, [collection.name, entry, getFormValues, getPreviewUrl, previewConfig]);

  return {
    isPreviewAvailable,
    previewUrl,
    openPreview,
    getPreviewUrl,
    label: previewConfig?.label || "Preview",
  };
}
