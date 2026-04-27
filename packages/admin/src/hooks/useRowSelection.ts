"use client";

import { useCallback, useState } from "react";

import { toast } from "@admin/components/ui";

import type { UseRowSelectionOptions } from "../types/hooks/row-selection";

/**
 * Custom hook for managing bulk row selection state in tables
 *
 * Provides selection state management with O(1) lookup performance using Set internally.
 * Supports single-item selection, page-level selection, and cross-page selection.
 *
 * ## Features
 * - Toggle individual rows on/off
 * - Select all rows on current page
 * - Select all rows across all pages
 * - Clear all selections
 * - Check if a specific row is selected
 * - Efficient O(1) lookup using Set data structure
 * - **Memory protection**: maxSelections guard (default: 1000 items)
 * - **Performance optimized**: Prevents large selections (1000+ items) from impacting browser
 *
 * ## Usage
 *
 * ### Basic Usage
 * ```tsx
 * const {
 *   selectedIds,
 *   selectedCount,
 *   toggleSelection,
 *   selectAll,
 *   clearSelection,
 *   isSelected,
 * } = useRowSelection();
 *
 * // In table row
 * <Checkbox
 *   checked={isSelected(row.id)}
 *   onCheckedChange={() => toggleSelection(row.id)}
 * />
 *
 * // Selection count
 * <span>{selectedCount} selected</span>
 *
 * // Clear button
 * <Button onClick={clearSelection}>Clear</Button>
 * ```
 *
 * ### Page-Level Selection
 * ```tsx
 * const usersOnPage = data?.data || [];
 *
 * // Select all on current page
 * const handleSelectAllOnPage = () => {
 *   selectAll(usersOnPage.map(u => u.id));
 * };
 *
 * // Checkbox state (3 states: unchecked, indeterminate, checked)
 * const pageIds = usersOnPage.map(u => u.id);
 * const selectedOnPage = pageIds.filter(id => isSelected(id)).length;
 * const checkboxState =
 *   selectedOnPage === 0
 *     ? false
 *     : selectedOnPage === pageIds.length
 *       ? true
 *       : "indeterminate";
 * ```
 *
 * ### Cross-Page Selection
 * ```tsx
 * // Select all users across all pages
 * const handleSelectAllUsers = async () => {
 *   const allUserIds = await fetchAllUserIds(); // API call
 *   selectAll(allUserIds);
 * };
 * ```
 *
 * @example
 * ```tsx
 * function UserTable() {
 *   const { selectedIds, toggleSelection, isSelected } = useRowSelection();
 *
 *   return (
 *     <table>
 *       {users.map(user => (
 *         <tr key={user.id}>
 *           <td>
 *             <Checkbox
 *               checked={isSelected(user.id)}
 *               onCheckedChange={() => toggleSelection(user.id)}
 *             />
 *           </td>
 *           <td>{user.name}</td>
 *         </tr>
 *       ))}
 *     </table>
 *   );
 * }
 * ```
 *
 * @returns Selection state and control functions
 *
 * @param options - Configuration options for selection behavior
 * @returns Selection state and control functions
 *
 * @see {@link https://nextly-docs.com/hooks/useRowSelection | Documentation}
 */
export function useRowSelection(options: UseRowSelectionOptions = {}) {
  const { maxSelections = 1000, onMaxSelectionsReached } = options;

  // Internal state: Set for O(1) lookups
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Toggle selection for a single row
   *
   * If the row is currently selected, it will be deselected.
   * If the row is not selected, it will be selected (unless maxSelections limit is reached).
   *
   * @param id - The unique identifier of the row
   *
   * @example
   * ```tsx
   * <Checkbox
   *   checked={isSelected(user.id)}
   *   onCheckedChange={() => toggleSelection(user.id)}
   * />
   * ```
   */
  const toggleSelection = useCallback(
    (id: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          // Always allow deselection
          next.delete(id);
        } else {
          // Check maxSelections limit before adding
          if (maxSelections !== undefined && next.size >= maxSelections) {
            // Show warning toast
            toast.warning("Selection limit reached", {
              description: `You can only select up to ${maxSelections} items at once.`,
            });

            // Call custom callback if provided
            if (onMaxSelectionsReached) {
              onMaxSelectionsReached(next.size + 1, maxSelections);
            }

            return prev; // Don't modify state
          }
          next.add(id);
        }
        return next;
      });
    },
    [maxSelections, onMaxSelectionsReached]
  );

  /**
   * Select all provided IDs
   *
   * Replaces the current selection with the provided IDs.
   * Used for "select all on page" or "select all users" functionality.
   * Respects maxSelections limit - will truncate if necessary.
   *
   * @param ids - Array of unique identifiers to select
   *
   * @example
   * ```tsx
   * // Select all users on current page
   * const pageUserIds = usersOnPage.map(u => u.id);
   * selectAll(pageUserIds);
   * ```
   */
  const selectAll = useCallback(
    (ids: string[]) => {
      // Check maxSelections limit
      if (maxSelections !== undefined && ids.length > maxSelections) {
        // Show warning toast
        toast.warning("Selection limit reached", {
          description: `Cannot select ${ids.length} items. Limiting to ${maxSelections} items.`,
        });

        // Call custom callback if provided
        if (onMaxSelectionsReached) {
          onMaxSelectionsReached(ids.length, maxSelections);
        }

        // Truncate to maxSelections
        setSelectedIds(new Set(ids.slice(0, maxSelections)));
      } else {
        setSelectedIds(new Set(ids));
      }
    },
    [maxSelections, onMaxSelectionsReached]
  );

  /**
   * Select all items on the current page (additive)
   *
   * Adds the provided page IDs to the existing selection without removing
   * previously selected items from other pages. Useful for cross-page selection.
   * Respects maxSelections limit - will add items until limit is reached.
   *
   * @param pageIds - Array of unique identifiers on the current page
   *
   * @example
   * ```tsx
   * // Add current page to selection
   * const pageUserIds = usersOnPage.map(u => u.id);
   * selectAllOnPage(pageUserIds);
   * ```
   */
  const selectAllOnPage = useCallback(
    (pageIds: string[]) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        let addedCount = 0;

        for (const id of pageIds) {
          // Check maxSelections limit before adding each item
          if (maxSelections !== undefined && next.size >= maxSelections) {
            // Show warning toast
            toast.warning("Selection limit reached", {
              description: `Cannot select more than ${maxSelections} items. Some items were not selected.`,
            });

            // Call custom callback if provided
            if (onMaxSelectionsReached) {
              onMaxSelectionsReached(prev.size + pageIds.length, maxSelections);
            }

            break; // Stop adding items
          }

          if (!next.has(id)) {
            next.add(id);
            addedCount++;
          }
        }

        return next;
      });
    },
    [maxSelections, onMaxSelectionsReached]
  );

  /**
   * Deselect all items on the current page
   *
   * Removes the provided page IDs from the selection while keeping
   * selections from other pages intact.
   *
   * @param pageIds - Array of unique identifiers on the current page to deselect
   *
   * @example
   * ```tsx
   * // Deselect all on current page
   * const pageUserIds = usersOnPage.map(u => u.id);
   * deselectAllOnPage(pageUserIds);
   * ```
   */
  const deselectAllOnPage = useCallback((pageIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      pageIds.forEach(id => next.delete(id));
      return next;
    });
  }, []);

  /**
   * Clear all selections
   *
   * Removes all selected items from the selection state.
   * Used for "Clear" button functionality.
   *
   * @example
   * ```tsx
   * <Button onClick={clearSelection}>Clear Selection</Button>
   * ```
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Check if a specific row is selected
   *
   * O(1) lookup performance using Set.has()
   *
   * @param id - The unique identifier of the row
   * @returns true if the row is selected, false otherwise
   *
   * @example
   * ```tsx
   * const checked = isSelected(user.id);
   * <Checkbox checked={checked} />
   * ```
   */
  const isSelected = useCallback(
    (id: string): boolean => {
      return selectedIds.has(id);
    },
    [selectedIds]
  );

  /**
   * Get the number of selected items on the current page
   *
   * Useful for determining the state of the "select all" checkbox:
   * - 0 selected → unchecked
   * - Some selected → indeterminate
   * - All selected → checked
   *
   * @param pageIds - Array of unique identifiers on the current page
   * @returns Number of items on current page that are selected
   *
   * @example
   * ```tsx
   * const pageUserIds = usersOnPage.map(u => u.id);
   * const selectedOnPage = getSelectedCountOnPage(pageUserIds);
   * const checkboxState =
   *   selectedOnPage === 0
   *     ? false
   *     : selectedOnPage === pageUserIds.length
   *       ? true
   *       : "indeterminate";
   * ```
   */
  const getSelectedCountOnPage = useCallback(
    (pageIds: string[]): number => {
      return pageIds.filter(id => selectedIds.has(id)).length;
    },
    [selectedIds]
  );

  return {
    /**
     * Array of selected row IDs
     *
     * Convert Set to Array for easier consumption by components
     * (e.g., passing to mutation hooks, displaying count)
     */
    selectedIds: Array.from(selectedIds),

    /**
     * Total number of selected rows
     *
     * Useful for displaying selection count in UI
     * (e.g., "5 selected", "10 users selected")
     */
    selectedCount: selectedIds.size,

    /**
     * Toggle selection for a single row
     */
    toggleSelection,

    /**
     * Select all provided IDs (replaces current selection)
     */
    selectAll,

    /**
     * Select all items on current page (additive)
     */
    selectAllOnPage,

    /**
     * Deselect all items on current page
     */
    deselectAllOnPage,

    /**
     * Clear all selections
     */
    clearSelection,

    /**
     * Check if a specific row is selected
     */
    isSelected,

    /**
     * Get count of selected items on current page
     */
    getSelectedCountOnPage,
  };
}
