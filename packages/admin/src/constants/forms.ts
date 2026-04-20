/**
 * Form Constants
 *
 * Shared constants for form components (height, width, spacing, etc.)
 */

/**
 * Maximum height for scrollable lists in forms
 * Used for roles lists, permission lists, etc.
 */
export const FORM_LIST_MAX_HEIGHT = "max-h-60"; // 240px (60 * 4px)

/**
 * Minimum height for form skeletons and loading states
 * Ensures consistent loading UI across create/edit pages
 */
export const FORM_MIN_HEIGHT = "h-[600px]";

/**
 * Form section titles font size and weight
 */
export const FORM_SECTION_TITLE = "text-lg font-semibold";

/**
 * Form grid layout - 2 columns on desktop, 1 on mobile
 */
export const FORM_GRID_LAYOUT = "grid grid-cols-1 md:grid-cols-2 gap-8";
