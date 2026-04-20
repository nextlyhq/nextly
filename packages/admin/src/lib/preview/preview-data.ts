/**
 * Preview Data Utilities
 *
 * Provides session storage-based utilities for previewing unsaved entry changes.
 * When an editor clicks "Preview" on an entry form with unsaved changes, the
 * current form data is stored in session storage and a preview key is appended
 * to the URL. The preview page can then retrieve this data to show the unsaved
 * version.
 *
 * @module lib/preview-data
 * @since 1.0.0
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Prefix for preview data keys in session storage.
 * Format: nextly-preview-{timestamp}
 */
const PREVIEW_DATA_KEY_PREFIX = "nextly-preview-";

/**
 * How long preview data remains valid (5 minutes).
 * After this time, stored preview data is considered stale and cleaned up.
 */
const PREVIEW_DATA_EXPIRY = 5 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

/**
 * Payload stored in session storage for preview data.
 */
export interface PreviewDataPayload {
  /** Collection slug the entry belongs to */
  collectionSlug: string;
  /** Entry ID if editing existing entry, undefined for new entries */
  entryId?: string;
  /** The entry data (including unsaved changes) */
  data: Record<string, unknown>;
  /** Timestamp when the data was stored */
  timestamp: number;
}

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Store entry data for preview.
 *
 * Saves the current form data to session storage, allowing the preview page
 * to access unsaved changes. Returns a unique key that can be passed to the
 * preview URL.
 *
 * @param collectionSlug - The collection slug
 * @param entryId - The entry ID (undefined for new entries)
 * @param data - The entry data to preview
 * @returns A unique key to retrieve the preview data
 *
 * @example
 * ```typescript
 * const previewKey = storePreviewData("posts", "123", formData);
 * const previewUrl = `/preview/posts/my-post?_preview=${previewKey}`;
 * ```
 */
export function storePreviewData(
  collectionSlug: string,
  entryId: string | undefined,
  data: Record<string, unknown>
): string {
  const key = `${PREVIEW_DATA_KEY_PREFIX}${Date.now()}`;
  const payload: PreviewDataPayload = {
    collectionSlug,
    entryId,
    data,
    timestamp: Date.now(),
  };

  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
    // Clean up old preview data to prevent storage bloat
    cleanupOldPreviewData();
  } catch (error) {
    console.error("Failed to store preview data:", error);
  }

  return key;
}

/**
 * Retrieve preview data by key.
 *
 * Gets stored preview data from session storage. Returns null if:
 * - The key doesn't exist
 * - The data has expired
 * - The data is malformed
 *
 * @param key - The preview data key (returned by storePreviewData)
 * @returns The stored preview payload, or null if not found/expired
 *
 * @example
 * ```typescript
 * const urlParams = new URLSearchParams(window.location.search);
 * const previewKey = urlParams.get("_preview");
 * if (previewKey) {
 *   const previewData = getPreviewData(previewKey);
 *   if (previewData) {
 *     // Use previewData.data instead of fetching from API
 *   }
 * }
 * ```
 */
export function getPreviewData(key: string): PreviewDataPayload | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;

    const payload = JSON.parse(stored) as PreviewDataPayload;

    // Check if data has expired
    if (Date.now() - payload.timestamp > PREVIEW_DATA_EXPIRY) {
      sessionStorage.removeItem(key);
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Remove preview data by key.
 *
 * Call this after the preview page has consumed the data, or when
 * the user navigates away from the preview.
 *
 * @param key - The preview data key to remove
 */
export function removePreviewData(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up expired preview data from session storage.
 *
 * Called automatically when storing new preview data. Removes any
 * preview data entries that are older than PREVIEW_DATA_EXPIRY.
 */
function cleanupOldPreviewData(): void {
  const now = Date.now();

  try {
    // Get all keys that match our prefix
    const keysToRemove: string[] = [];

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(PREVIEW_DATA_KEY_PREFIX)) continue;

      try {
        const stored = sessionStorage.getItem(key);
        if (!stored) continue;

        const payload = JSON.parse(stored) as PreviewDataPayload;
        if (now - payload.timestamp > PREVIEW_DATA_EXPIRY) {
          keysToRemove.push(key);
        }
      } catch {
        // Remove malformed entries
        keysToRemove.push(key);
      }
    }

    // Remove expired keys
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Generate a preview URL with the preview data key appended.
 *
 * Appends the `_preview` query parameter to the base URL so the preview
 * page knows to look for stored preview data.
 *
 * @param baseUrl - The base preview URL (may be relative or absolute)
 * @param previewKey - The key returned by storePreviewData
 * @returns The full preview URL with the preview key parameter
 *
 * @example
 * ```typescript
 * const previewKey = storePreviewData("posts", "123", formData);
 * const baseUrl = "/preview/posts/my-post";
 * const fullUrl = generatePreviewUrlWithData(baseUrl, previewKey);
 * // Result: "/preview/posts/my-post?_preview=nextly-preview-1234567890"
 * ```
 */
export function generatePreviewUrlWithData(
  baseUrl: string,
  previewKey: string
): string {
  try {
    // Handle both relative and absolute URLs
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set("_preview", previewKey);

    // Return relative URL if input was relative
    if (baseUrl.startsWith("/")) {
      return url.pathname + url.search;
    }

    return url.toString();
  } catch {
    // Fallback: simple query string append
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}_preview=${encodeURIComponent(previewKey)}`;
  }
}

/**
 * Check if the current page has preview data available.
 *
 * Useful for preview pages to determine if they should use stored
 * preview data instead of fetching from the API.
 *
 * @returns The preview key if present in URL and data exists, null otherwise
 *
 * @example
 * ```typescript
 * const previewKey = hasPreviewData();
 * if (previewKey) {
 *   const previewData = getPreviewData(previewKey);
 *   // Use preview data
 * } else {
 *   // Fetch from API normally
 * }
 * ```
 */
export function hasPreviewData(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const previewKey = urlParams.get("_preview");

    if (!previewKey) return null;

    // Verify the data actually exists
    const data = getPreviewData(previewKey);
    return data ? previewKey : null;
  } catch {
    return null;
  }
}
