/**
 * Configuration options for useRowSelection hook
 *
 * @see {@link useRowSelection}
 */
export interface UseRowSelectionOptions {
  /**
   * Maximum number of items that can be selected simultaneously
   *
   * Prevents memory issues with large datasets by limiting selection size.
   * When limit is reached, users are shown a warning toast.
   *
   * @default 1000 (recommended for performance)
   */
  maxSelections?: number;

  /**
   * Callback function called when selection limit is reached
   *
   * @param attemptedCount - Number of items user tried to select
   * @param maxAllowed - Maximum allowed selections
   */
  onMaxSelectionsReached?: (attemptedCount: number, maxAllowed: number) => void;
}

/**
 * Return type for useRowSelection hook
 *
 * Provides all state and methods needed for managing bulk row selection in tables.
 *
 * @see {@link useRowSelection}
 */
export interface UseRowSelectionReturn {
  /**
   * Array of selected row IDs
   *
   * @example
   * ```tsx
   * console.log(selectedIds); // ["user-1", "user-3", "user-5"]
   * ```
   */
  selectedIds: string[];

  /**
   * Total number of selected rows
   *
   * @example
   * ```tsx
   * <span>{selectedCount} selected</span> // "3 selected"
   * ```
   */
  selectedCount: number;

  /**
   * Toggle selection for a single row
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
  toggleSelection: (id: string) => void;

  /**
   * Select all provided IDs (replaces current selection)
   *
   * @param ids - Array of unique identifiers to select
   *
   * @example
   * ```tsx
   * // Select all users on current page
   * selectAll(usersOnPage.map(u => u.id));
   * ```
   */
  selectAll: (ids: string[]) => void;

  /**
   * Select all items on current page (additive)
   *
   * Adds page IDs to existing selection without removing selections from other pages.
   *
   * @param pageIds - Array of unique identifiers on current page
   *
   * @example
   * ```tsx
   * selectAllOnPage(usersOnPage.map(u => u.id));
   * ```
   */
  selectAllOnPage: (pageIds: string[]) => void;

  /**
   * Deselect all items on current page
   *
   * Removes page IDs from selection while keeping selections from other pages.
   *
   * @param pageIds - Array of unique identifiers on current page
   *
   * @example
   * ```tsx
   * deselectAllOnPage(usersOnPage.map(u => u.id));
   * ```
   */
  deselectAllOnPage: (pageIds: string[]) => void;

  /**
   * Clear all selections
   *
   * @example
   * ```tsx
   * <Button onClick={clearSelection}>Clear</Button>
   * ```
   */
  clearSelection: () => void;

  /**
   * Check if a specific row is selected
   *
   * @param id - The unique identifier of the row
   * @returns true if the row is selected, false otherwise
   *
   * @example
   * ```tsx
   * const checked = isSelected(user.id);
   * ```
   */
  isSelected: (id: string) => boolean;

  /**
   * Get count of selected items on current page
   *
   * @param pageIds - Array of unique identifiers on current page
   * @returns Number of items on current page that are selected
   *
   * @example
   * ```tsx
   * const selectedOnPage = getSelectedCountOnPage(usersOnPage.map(u => u.id));
   * ```
   */
  getSelectedCountOnPage: (pageIds: string[]) => number;
}
