/**
 * Sidebar Layout Constants
 *
 * Centralized constants for sidebar dimensions and layout values.
 * This ensures consistency across all sidebar-related components.
 */

/**
 * Sidebar width when expanded (desktop)
 * - Icon sidebar (72px) + Sub sidebar (256px / 16rem)
 * - Total: 328px (20.5rem)
 */
export const SIDEBAR_WIDTH_EXPANDED = 328;
export const SIDEBAR_WIDTH_EXPANDED_REM = "20.5rem";

/**
 * Sidebar width when collapsed (desktop)
 * - Just the Icon sidebar (72px)
 * - Total: 72px (4.5rem)
 */
export const SIDEBAR_WIDTH_COLLAPSED = 72;
export const SIDEBAR_WIDTH_COLLAPSED_REM = "4.5rem";

/**
 * Mobile drawer width
 * - Pixel value: 288px (18rem)
 * - CSS value: "18rem"
 * - Tailwind: w-72
 */
export const MOBILE_DRAWER_WIDTH = 288;
export const MOBILE_DRAWER_WIDTH_REM = "18rem";

/**
 * User panel width (desktop)
 * - Pixel value: 288px (18rem)
 * - Tailwind: w-72
 */
export const USER_PANEL_WIDTH = 288;

/**
 * Sidebar breakpoint for mobile/desktop transition
 * - Tailwind: md (768px)
 */
export const SIDEBAR_BREAKPOINT = 768;
