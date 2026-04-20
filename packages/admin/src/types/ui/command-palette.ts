/**
 * Command Palette Types
 *
 * TypeScript type definitions for the CommandPalette component.
 * Exported for library consumers to extend or customize.
 */

/**
 * CommandConfig
 *
 * Base interface for all command palette items (configuration).
 * Used for both navigation commands and action commands.
 *
 * Note: Named "CommandConfig" to avoid naming conflict with the Command component
 * from cmdk library (./components/Command).
 *
 * @property id - Unique identifier for the command
 * @property label - Display label shown in the command palette
 * @property icon - Lucide React icon component
 * @property href - Next.js route path to navigate to
 * @property keywords - Array of keywords for improved fuzzy search matching
 * @property shortcut - Optional keyboard shortcut display (e.g., "G D", "⌘N")
 * @property disabled - Optional flag to disable the command (for future/unavailable routes)
 *
 * @pattern
 * Commands should navigate to pages/forms, NOT execute destructive actions directly.
 * This follows industry best practices (GitHub, Linear, Vercel) where command palettes
 * are used for navigation and opening forms, with actual mutations requiring confirmation.
 *
 * @example
 * ```tsx
 * const command: CommandConfig = {
 *   id: "nav-dashboard",
 *   label: "Dashboard",
 *   icon: Home,
 *   href: "/admin",
 *   keywords: ["home", "overview"],
 *   shortcut: "G D"
 * };
 * ```
 */
export interface CommandConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords: string[];
  shortcut?: string;
  disabled?: boolean;
}

/**
 * Navigation Command
 *
 * Type alias for navigation commands (Dashboard, Users, Roles, etc.).
 * Structurally identical to CommandConfig, but provides semantic clarity.
 *
 * @see CommandConfig for full documentation
 */
export type NavigationCommand = CommandConfig;

/**
 * Action Command
 *
 * Type alias for action commands (Create User, Create Role, etc.).
 * Structurally identical to CommandConfig, but provides semantic clarity.
 *
 * @see CommandConfig for full documentation
 */
export type ActionCommand = CommandConfig;

/**
 * Command Palette Props
 *
 * Props for the CommandPalette component.
 * Currently no props needed - component is fully self-contained.
 * Empty object type for future extensibility.
 */
export type CommandPaletteProps = Record<string, never>;

/**
 * User Search Results Props
 *
 * Props for the UserSearchResults component.
 * Used within CommandPalette for dynamic user search.
 *
 * @property search - Current search query from command palette input
 * @property onSelect - Callback to handle user selection (navigation)
 *
 * @example
 * ```tsx
 * <UserSearchResults
 *   search="john"
 *   onSelect={(callback) => {
 *     setOpen(false);
 *     callback();
 *   }}
 * />
 * ```
 */
export interface UserSearchResultsProps {
  /**
   * Search query string from command palette input.
   * Debounced internally to reduce API calls.
   */
  search: string;

  /**
   * Callback fired when a user is selected.
   * Parent component should close the dialog and execute navigation.
   *
   * @param callback - Function to execute (navigation)
   */
  onSelect: (callback: () => void) => void;
}
