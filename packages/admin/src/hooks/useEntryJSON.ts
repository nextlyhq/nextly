/**
 * useEntryJSON Hook
 *
 * Fetches entry data with configurable relationship depth for displaying
 * raw JSON API responses. Used by ShowJSONDialog and potentially API Playground.
 *
 * @module hooks/useEntryJSON
 * @since 1.0.0
 */

import { useState, useCallback, useEffect } from "react";

import { entryApi } from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

// ============================================================================
// Types
// ============================================================================

export interface UseEntryJSONOptions {
  /** Collection slug */
  collectionSlug: string;
  /** Entry ID to fetch */
  entryId: string;
  /** Initial depth for relationship population (default: 0) */
  initialDepth?: number;
  /** Whether to fetch immediately on mount (default: false) */
  fetchOnMount?: boolean;
}

export interface UseEntryJSONReturn {
  /** The fetched entry data */
  data: Entry | null;
  /** Whether data is currently being fetched */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Current depth setting */
  depth: number;
  /** Update the depth and refetch */
  setDepth: (depth: number) => void;
  /** Manually trigger a fetch */
  refetch: () => Promise<void>;
  /** The API URL for the current request */
  apiUrl: string;
  /** Formatted JSON string */
  jsonString: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum allowed depth for relationship population */
export const MAX_DEPTH = 5;

/** Minimum allowed depth */
export const MIN_DEPTH = 0;

// ============================================================================
// Hook
// ============================================================================

/**
 * useEntryJSON - Fetches entry data with configurable depth
 *
 * Provides loading/error states and formatted JSON output for displaying
 * raw API responses in the admin UI.
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   isLoading,
 *   error,
 *   depth,
 *   setDepth,
 *   refetch,
 *   apiUrl,
 *   jsonString,
 * } = useEntryJSON({
 *   collectionSlug: 'posts',
 *   entryId: 'abc123',
 *   initialDepth: 1,
 *   fetchOnMount: true,
 * });
 *
 * // Change depth (triggers refetch)
 * setDepth(2);
 *
 * // Copy JSON to clipboard
 * navigator.clipboard.writeText(jsonString);
 * ```
 */
export function useEntryJSON({
  collectionSlug,
  entryId,
  initialDepth = 0,
  fetchOnMount = false,
}: UseEntryJSONOptions): UseEntryJSONReturn {
  const [data, setData] = useState<Entry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepthState] = useState(
    Math.min(Math.max(initialDepth, MIN_DEPTH), MAX_DEPTH)
  );

  // Build the API URL for display
  const apiUrl = `/api/collections/${collectionSlug}/entries/${entryId}${depth > 0 ? `?depth=${depth}` : ""}`;

  // Format JSON string with pretty printing
  const jsonString = data ? JSON.stringify(data, null, 2) : "";

  /**
   * Fetch entry data with current depth
   */
  const fetchEntry = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const entry = await entryApi.findByID(collectionSlug, entryId, {
        depth,
      });
      setData(entry);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch entry";
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [collectionSlug, entryId, depth]);

  /**
   * Update depth and trigger refetch
   */
  const setDepth = useCallback((newDepth: number) => {
    const clampedDepth = Math.min(Math.max(newDepth, MIN_DEPTH), MAX_DEPTH);
    setDepthState(clampedDepth);
  }, []);

  // Fetch on mount if requested
  useEffect(() => {
    if (fetchOnMount) {
      fetchEntry();
    }
  }, [fetchOnMount, fetchEntry]);

  // Refetch when depth changes (only after initial mount)
  useEffect(() => {
    if (data !== null || error !== null) {
      // Only refetch if we've already loaded once
      fetchEntry();
    }
    // Reason: only re-fetch when depth changes; fetchEntry/data/error are
    // intentionally excluded to avoid loops — the guard above ensures this
    // only fires after initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  return {
    data,
    isLoading,
    error,
    depth,
    setDepth,
    refetch: fetchEntry,
    apiUrl,
    jsonString,
  };
}
