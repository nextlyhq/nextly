"use client";

import * as React from "react";

import { Loader2, Search, X } from "@admin/components/icons";
import { Input } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import type { SearchBarProps } from "./types";

/**
 * SearchBar Component
 *
 * A reusable search bar component with debounced input, clear button, and loading indicator.
 * Designed for data tables, lists, and any component that requires search functionality.
 *
 * ## Design Specifications
 * - **Height**: 40px (h-10) - matches Input default size
 * - **Icon Size**: 16px (h-4 w-4) - lucide-react icons
 * - **Debounce**: Configurable delay (default: 300ms)
 * - **Border Radius**: `rounded-md`, the same `--radius` step as Input
 * - **Spacing**: Icons have 12px padding from edges
 *
 * ## Features
 * - **Debounced input**: Reduces API calls by delaying onChange until user stops typing
 * - **Clear button**: X icon appears when value is not empty, clears input on click
 * - **Loading indicator**: Animated spinner shows during data fetching
 * - **Keyboard support**: Focus management, Enter key support
 * - **Accessibility**: Proper ARIA attributes, aria-busy during loading
 *
 * ## Accessibility
 * - `aria-busy` attribute indicates loading state to screen readers
 * - Clear button has `aria-label` for screen readers
 * - Input maintains focus after clear action
 * - Loading spinner has `aria-hidden` (visual indicator only)
 *
 * ## Usage Examples
 *
 * ### Basic Usage
 * ```tsx
 * import { SearchBar } from "@nextly/admin";
 *
 * function UserList() {
 *   const [search, setSearch] = useState("");
 *
 *   return (
 *     <SearchBar
 *       value={search}
 *       onChange={setSearch}
 *       placeholder="Search users..."
 *     />
 *   );
 * }
 * ```
 *
 * ### With Loading State
 * ```tsx
 * function UserList() {
 *   const [search, setSearch] = useState("");
 *   const { data, isLoading } = useUsers({ filters: { search } });
 *
 *   return (
 *     <SearchBar
 *       value={search}
 *       onChange={setSearch}
 *       placeholder="Search users..."
 *       isLoading={isLoading}
 *     />
 *   );
 * }
 * ```
 *
 * ### Custom Debounce Delay
 * ```tsx
 * <SearchBar
 *   value={search}
 *   onChange={setSearch}
 *   placeholder="Search..."
 *   debounceDelay={500} // Wait 500ms instead of default 300ms
 * />
 * ```
 *
 * ### With Custom Width
 * ```tsx
 * <SearchBar
 *   value={search}
 *   onChange={setSearch}
 *   placeholder="Search..."
 *   className="w-full md:w-96"
 * />
 * ```
 *
 * @example
 * ```tsx
 * <SearchBar
 *   value={searchQuery}
 *   onChange={setSearchQuery}
 *   placeholder="Search users by name or email"
 *   isLoading={isLoadingUsers}
 * />
 * ```
 */
export const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      value = "",
      onChange,
      placeholder = "Search...",
      debounceDelay = 300,
      isLoading = false,
      className,
      ...props
    },
    ref
  ) => {
    // Internal state for immediate UI updates
    const [internalValue, setInternalValue] = React.useState(value);

    // Sync internal value when parent value changes externally
    React.useEffect(() => {
      setInternalValue(value);
    }, [value]);

    // Use a timer to debounce onChange calls
    React.useEffect(() => {
      // Don't trigger if it matches the current parent value
      if (internalValue === value) return;

      const timer = setTimeout(() => {
        onChange(internalValue);
      }, debounceDelay);

      return () => clearTimeout(timer);
    }, [internalValue, value, debounceDelay, onChange]);

    // Handle input change
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInternalValue(e.target.value);
    };

    // Handle clear button click
    const handleClear = () => {
      setInternalValue("");
      onChange("");
      // Focus input after clearing
      if (ref && "current" in ref && ref.current) {
        ref.current.focus();
      }
    };

    return (
      <div className={cn("relative w-full max-w-lg", className)}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        {/* Composes Input rather than restating its classes. The copy this
            replaced had drifted from the original in twelve ways that a reader
            comparing them would not notice: no `aria-invalid` or
            `data-[invalid=true]` handling at all, so a search field could not
            show an error state; `focus:border-primary` without the `!` Input
            uses, so the focus ring lost to any later border utility; and no
            `selection:*` colours, `placeholder:opacity-50` or
            `disabled:pointer-events-none`.

            It also meant palette work reached every input EXCEPT this one,
            because the border token was named in two places and only one of
            them was maintained. Only the search-specific parts stay here: room
            for the leading icon and the trailing clear button. */}
        <Input
          // Before the spread, not after: a caller passing its own
          // `data-testid` must win. This is a publicly exported component whose
          // props extend the native input's, so silently replacing a consumer's
          // test hook with an internal one breaks their tests and gives them no
          // way to address the field.
          data-testid="search-input"
          {...props}
          ref={ref}
          // `search`, not `text`: assistive technology announces it as a search
          // field, and the suite has asserted this since it was written. The
          // native WebKit cancel button is suppressed because this component
          // renders its own clear affordance, which also handles focus return.
          type="search"
          placeholder={placeholder}
          value={internalValue}
          onChange={handleChange}
          aria-busy={isLoading}
          className="h-10 pl-10 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
        />

        {/* Right side icons (clear button + loading spinner) */}
        {(internalValue || isLoading) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {/* Loading spinner */}
            {isLoading && (
              <Loader2
                className="h-3.5 w-3.5 text-primary animate-spin"
                aria-hidden="true"
              />
            )}

            {/* Clear button */}
            {internalValue && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-md hover-unified"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

SearchBar.displayName = "SearchBar";
