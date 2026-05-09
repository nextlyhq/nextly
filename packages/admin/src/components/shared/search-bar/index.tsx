"use client";

import * as React from "react";

import { Loader2, Search, X } from "@admin/components/icons";
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
 * - **Border Radius**: 6px (rounded-none) - matches Input component
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
        <input
          {...props}
          ref={ref}
          type="text"
          placeholder={placeholder}
          value={internalValue}
          onChange={handleChange}
          aria-busy={isLoading}
          className="h-10 w-full rounded-none border border-primary/5 bg-background text-foreground pl-10 pr-10 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-all"
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
                className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded-none hover-unified"
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
