/**
 * Shared Components
 *
 * Cross-cutting components used across multiple features.
 * These components don't fit into ui/, features/, forms/, or layout/ tiers.
 */

// Search and Pagination
export { SearchBar } from "./search-bar";
export type { SearchBarProps } from "./search-bar/types";
export { Pagination } from "./pagination";
export type { PaginationProps } from "./pagination/types";

// Bulk Operations
export { BulkActionBar } from "./bulk-action-bar";

// Command Palette
export { CommandPalette } from "./command-palette";
export { ActionCommands } from "./command-palette/ActionCommands";
export { UserSearchResults } from "./command-palette/UserSearchResults";

// Error Handling
export {
  PageErrorFallback,
  SectionErrorFallback,
  InlineErrorFallback,
} from "./error-fallbacks";
export type {
  PageErrorFallbackProps,
  SectionErrorFallbackProps,
  InlineErrorFallbackProps,
} from "./error-fallbacks";

// Theme
export { ThemeToggle } from "./theme-toggle";

// Password
export { PasswordStrengthIndicator } from "./password-strength-indicator";
export type { PasswordStrengthIndicatorProps } from "./password-strength-indicator";
