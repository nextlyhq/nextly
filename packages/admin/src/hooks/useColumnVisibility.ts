/**
 * Column Visibility Hook
 *
 * React hook for managing column visibility with localStorage persistence.
 * Designed to work with TanStack Table v8's column visibility system.
 *
 * @module hooks/useColumnVisibility
 * @since 1.0.0
 */

import type { VisibilityState } from "@tanstack/react-table";
import { useState, useEffect, useCallback, useMemo } from "react";

// ============================================================================
// Constants
// ============================================================================

/**
 * LocalStorage key prefix for column visibility settings.
 * Format: `nextly-column-visibility-{collectionSlug}`
 */
const STORAGE_KEY_PREFIX = "nextly-column-visibility-";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the useColumnVisibility hook.
 */
export interface UseColumnVisibilityOptions {
  /** The collection slug to persist visibility for */
  collectionSlug: string;
  /** All available column IDs in the table */
  availableColumns: string[];
  /** Default visible columns (from collection config or all columns) */
  defaultVisible?: string[];
}

/**
 * Return type of the useColumnVisibility hook.
 */
export interface UseColumnVisibilityReturn {
  /** Current column visibility state for TanStack Table */
  columnVisibility: VisibilityState;
  /** Callback for TanStack Table's onColumnVisibilityChange */
  onColumnVisibilityChange: (
    updaterOrValue:
      | VisibilityState
      | ((prev: VisibilityState) => VisibilityState)
  ) => void;
  /** Array of currently visible column IDs */
  visibleColumns: string[];
  /** Toggle a specific column's visibility */
  toggleColumn: (columnId: string) => void;
  /** Show a specific column */
  showColumn: (columnId: string) => void;
  /** Hide a specific column */
  hideColumn: (columnId: string) => void;
  /** Set visible columns to a specific array */
  setColumns: (columnIds: string[]) => void;
  /** Reset to default visibility */
  resetToDefault: () => void;
  /** Check if a column is currently visible */
  isColumnVisible: (columnId: string) => boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert array of visible column IDs to TanStack Table VisibilityState.
 * VisibilityState is an object where keys are column IDs and values are booleans.
 * By default, all columns are visible, so we only need to set hidden columns to false.
 */
function toVisibilityState(
  visibleColumns: string[],
  allColumns: string[]
): VisibilityState {
  const state: VisibilityState = {};
  for (const col of allColumns) {
    // Only set false for hidden columns (TanStack defaults to true)
    if (!visibleColumns.includes(col)) {
      state[col] = false;
    }
  }
  return state;
}

/**
 * Convert TanStack Table VisibilityState to array of visible column IDs.
 */
function toVisibleColumns(
  state: VisibilityState,
  allColumns: string[]
): string[] {
  return allColumns.filter(col => state[col] !== false);
}

/**
 * Get the storage key for a collection's column visibility.
 */
function getStorageKey(collectionSlug: string): string {
  return `${STORAGE_KEY_PREFIX}${collectionSlug}`;
}

/**
 * Simple hash of default columns for staleness detection.
 * When the code changes default columns, stored preferences are invalidated.
 */
function hashDefaults(defaults: string[]): string {
  return defaults.slice().sort().join(",");
}

/**
 * Load visibility state from localStorage.
 * Returns null if nothing stored, stale, or on error.
 *
 * Stores both the visible columns and a hash of the defaults they were
 * based on. When defaults change (e.g., "title" added), the stale stored
 * state is discarded so users get the updated defaults.
 */
function loadFromStorage(
  collectionSlug: string,
  availableColumns: string[],
  defaultColumns?: string[]
): string[] | null {
  try {
    const stored = localStorage.getItem(getStorageKey(collectionSlug));
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Support new format: { columns: string[], defaultsHash: string }
    // Fall back to legacy format: string[] (no hash — always stale)
    let columns: string[];
    let storedHash: string | undefined;

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.columns)
    ) {
      columns = parsed.columns;
      storedHash = parsed.defaultsHash;
    } else if (Array.isArray(parsed)) {
      // Legacy format — no hash, treat as stale if defaults are provided
      columns = parsed;
      storedHash = undefined;
    } else {
      return null;
    }

    // If defaults were provided, check if the stored state is stale
    if (defaultColumns && defaultColumns.length > 0) {
      const currentHash = hashDefaults(defaultColumns);
      if (storedHash !== currentHash) {
        // Defaults changed since last save — discard stale stored state
        return null;
      }
    }

    // Filter to only include columns that still exist
    const validated = columns.filter(col => availableColumns.includes(col));

    // If all stored columns were removed, return null to use defaults
    if (validated.length === 0 && columns.length > 0) return null;

    return validated;
  } catch {
    // Ignore parse errors or localStorage access errors
    return null;
  }
}

/**
 * Save visibility state to localStorage.
 * Includes a hash of the current defaults for staleness detection.
 */
function saveToStorage(
  collectionSlug: string,
  visibleColumns: string[],
  defaultColumns?: string[]
): void {
  try {
    localStorage.setItem(
      getStorageKey(collectionSlug),
      JSON.stringify({
        columns: visibleColumns,
        defaultsHash: defaultColumns ? hashDefaults(defaultColumns) : undefined,
      })
    );
  } catch {
    // Ignore storage errors (e.g., quota exceeded, private browsing)
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing column visibility with localStorage persistence.
 *
 * Designed to integrate with TanStack Table v8 by providing:
 * - `columnVisibility` - Pass to table's `state.columnVisibility`
 * - `onColumnVisibilityChange` - Pass to table's `onColumnVisibilityChange`
 *
 * Features:
 * - Persists column visibility per collection to localStorage
 * - Validates stored columns against available columns
 * - Provides reset to default functionality
 * - Compatible with TanStack Table's visibility state format
 *
 * @param options - Hook configuration options
 * @returns Column visibility state and actions
 *
 * @example
 * ```tsx
 * function EntryTable({ collection, columns }) {
 *   const availableColumns = columns.map(c => c.id);
 *   const defaultVisible = collection.admin?.defaultColumns ?? availableColumns;
 *
 *   const {
 *     columnVisibility,
 *     onColumnVisibilityChange,
 *     resetToDefault,
 *   } = useColumnVisibility({
 *     collectionSlug: collection.slug,
 *     availableColumns,
 *     defaultVisible,
 *   });
 *
 *   const table = useReactTable({
 *     // ...
 *     state: { columnVisibility },
 *     onColumnVisibilityChange,
 *   });
 *
 *   return (
 *     <>
 *       <button onClick={resetToDefault}>Reset Columns</button>
 *       <Table table={table} />
 *     </>
 *   );
 * }
 * ```
 */
export function useColumnVisibility({
  collectionSlug,
  availableColumns,
  defaultVisible,
}: UseColumnVisibilityOptions): UseColumnVisibilityReturn {
  // ---------------------------------------------------------------------------
  // Compute Default Columns
  // ---------------------------------------------------------------------------

  // Use provided defaults or all columns
  const defaultColumns = useMemo(
    () => defaultVisible ?? availableColumns,
    [defaultVisible, availableColumns]
  );

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // Initialize from localStorage or defaults
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const stored = loadFromStorage(
      collectionSlug,
      availableColumns,
      defaultColumns
    );
    return stored ?? defaultColumns;
  });

  // ---------------------------------------------------------------------------
  // Derived State
  // ---------------------------------------------------------------------------

  // Convert to TanStack Table format
  const columnVisibility = useMemo(
    () => toVisibilityState(visibleColumns, availableColumns),
    [visibleColumns, availableColumns]
  );

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  // Save to localStorage when visibility changes
  useEffect(() => {
    saveToStorage(collectionSlug, visibleColumns, defaultColumns);
  }, [collectionSlug, visibleColumns, defaultColumns]);

  // Reset state when collection changes
  useEffect(() => {
    const stored = loadFromStorage(
      collectionSlug,
      availableColumns,
      defaultColumns
    );
    setVisibleColumns(stored ?? defaultColumns);
  }, [collectionSlug, availableColumns, defaultColumns]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Handler for TanStack Table's onColumnVisibilityChange.
   * Accepts either a new state object or an updater function.
   */
  const onColumnVisibilityChange = useCallback(
    (
      updaterOrValue:
        | VisibilityState
        | ((prev: VisibilityState) => VisibilityState)
    ) => {
      setVisibleColumns(prev => {
        const currentState = toVisibilityState(prev, availableColumns);
        const newState =
          typeof updaterOrValue === "function"
            ? updaterOrValue(currentState)
            : updaterOrValue;
        return toVisibleColumns(newState, availableColumns);
      });
    },
    [availableColumns]
  );

  /**
   * Toggle a specific column's visibility.
   */
  const toggleColumn = useCallback((columnId: string) => {
    setVisibleColumns(prev =>
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  }, []);

  /**
   * Show a specific column.
   */
  const showColumn = useCallback((columnId: string) => {
    setVisibleColumns(prev =>
      prev.includes(columnId) ? prev : [...prev, columnId]
    );
  }, []);

  /**
   * Hide a specific column.
   */
  const hideColumn = useCallback((columnId: string) => {
    setVisibleColumns(prev => prev.filter(id => id !== columnId));
  }, []);

  /**
   * Set visible columns to a specific array.
   * Filters to only include columns that exist in availableColumns.
   */
  const setColumns = useCallback(
    (columnIds: string[]) => {
      const validColumns = columnIds.filter(col =>
        availableColumns.includes(col)
      );
      setVisibleColumns(
        validColumns.length > 0 ? validColumns : defaultColumns
      );
    },
    [availableColumns, defaultColumns]
  );

  /**
   * Reset to default visibility.
   * Uses collection's defaultColumns if defined, otherwise shows all columns.
   */
  const resetToDefault = useCallback(() => {
    setVisibleColumns(defaultColumns);
  }, [defaultColumns]);

  /**
   * Check if a column is currently visible.
   */
  const isColumnVisible = useCallback(
    (columnId: string) => visibleColumns.includes(columnId),
    [visibleColumns]
  );

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    toggleColumn,
    showColumn,
    hideColumn,
    setColumns,
    resetToDefault,
    isColumnVisible,
  };
}
