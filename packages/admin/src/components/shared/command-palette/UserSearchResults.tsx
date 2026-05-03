"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  CommandGroup,
  CommandItem,
} from "@revnixhq/ui";
import { useRouter } from "next/navigation";

import { User as UserIcon } from "@admin/components/icons";
import { useUsers } from "@admin/hooks/queries/useUsers";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { getInitials } from "@admin/lib/utils";

/**
 * Search Configuration Constants
 *
 * Centralized configuration for search behavior to ensure consistency
 * across all search components (users, roles, settings, etc.)
 */
const SEARCH_DEBOUNCE_MS = 300; // Delay before triggering search query
const MIN_SEARCH_LENGTH = 2; // Minimum characters required to search
const MAX_RESULTS = 10; // Maximum results to display (performance optimization)
const FIRST_PAGE = 0; // Zero-indexed first page for pagination

/**
 * User Search Results Component
 *
 * Dynamic user search within the command palette.
 * Queries users via TanStack Query and displays results with avatars.
 *
 * @example
 * ```tsx
 * <UserSearchResults search="john" onSelect={handleSelect} />
 * ```
 *
 * @features
 * - Debounced search (300ms) to reduce API calls
 * - Limit to 10 results for performance
 * - TanStack Query integration (caching, deduplication)
 * - Loading state while fetching
 * - Error handling for failed queries
 * - Empty state for no results
 * - Avatar + name + email display
 * - Navigation to user profile on selection
 *
 * @design-spec
 * - Icons: 16×16px (h-4 w-4)
 * - Avatars: 32×32px (size="md")
 * - Items: 36px desktop (h-9), 44px mobile (h-11)
 * - Email: Right-aligned, text-muted-foreground
 * - Spacing: mr-2 for avatars, gap-2 for content
 *
 * @accessibility
 * - ARIA: Each item has role="option"
 * - Keyboard: Arrow keys, Enter, Escape inherited from cmdk
 * - Screen readers: Names announced, emails as supplementary text
 * - Keywords: Email and user ID for improved search matching
 *
 * @performance
 * - Debounced search (300ms) prevents excessive API calls
 * - Limit to 10 results prevents lag with large datasets
 * - Conditional query execution (only when search >= 2 characters)
 * - TanStack Query caching (5min staleTime from QueryProvider)
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

/**
 * UserSearchResults Component
 *
 * Renders a CommandGroup with dynamic user search results.
 * Used within CommandPalette for keyboard-driven user navigation.
 *
 * @param search - Current search query from command palette
 * @param onSelect - Callback to handle user selection
 */
export function UserSearchResults({
  search,
  onSelect,
}: UserSearchResultsProps) {
  const router = useRouter();

  // Debounce search input using reusable hook
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  /**
   * Fetch users via TanStack Query
   * Optimizations:
   * - Only query when search >= MIN_SEARCH_LENGTH (prevents unnecessary API calls)
   * - Limit to MAX_RESULTS for performance
   * - Uses debounced search value (reduces API calls during typing)
   * - TanStack Query handles race conditions automatically
   */
  const {
    data: usersResponse,
    isLoading,
    error,
  } = useUsers(
    {
      pagination: { page: FIRST_PAGE, pageSize: MAX_RESULTS },
      filters: { search: debouncedSearch },
      sorting: [],
    },
    {
      // Only run query when search is long enough
      enabled: debouncedSearch.length >= MIN_SEARCH_LENGTH,
    }
  );

  const users = usersResponse?.items || [];
  const shouldShow = debouncedSearch.length >= MIN_SEARCH_LENGTH;

  // Don't render if search query too short
  if (!shouldShow) return null;

  // Loading state
  if (isLoading) {
    return (
      <CommandGroup heading="Users">
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
          <UserIcon className="h-4 w-4 animate-pulse" />
          <span>Searching users...</span>
        </div>
      </CommandGroup>
    );
  }

  // Error state with conditional logging
  if (error) {
    // Development: Log detailed error information for debugging
    // Production: Log minimal info to avoid exposing sensitive implementation details
    if (process.env.NODE_ENV === "development") {
      console.error("[UserSearchResults] User search failed:", {
        error,
        searchQuery: debouncedSearch,
        message: error.message,
        stack: error.stack,
      });
    } else {
      // Production: minimal logging (or send to error tracking service)
      console.error("[UserSearchResults] User search failed");
    }

    return (
      <CommandGroup heading="Users">
        <div className="px-2 py-1.5 text-sm text-destructive">
          Failed to search users. Please try again.
        </div>
      </CommandGroup>
    );
  }

  // Explicit empty state (shows even when navigation/action commands have results)
  if (users.length === 0) {
    return (
      <CommandGroup heading="Users">
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          No users found matching &quot;{debouncedSearch}&quot;
        </div>
      </CommandGroup>
    );
  }

  // Results
  return (
    <CommandGroup heading="Users">
      {users.map(user => (
        <CommandItem
          key={user.id}
          value={`${user.name} ${user.email}`}
          keywords={[user.email, user.id]}
          onSelect={() =>
            onSelect(() => router.push(`/admin/users/${user.id}`))
          }
        >
          <Avatar size="md" className="mr-2">
            <AvatarImage src={user.image || undefined} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <span>{user.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {user.email}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
