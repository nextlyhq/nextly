import { Search, Loader2, X } from "lucide-react";

/**
 * Props for TableSearch component
 */
export interface TableSearchProps {
  /** Current search value */
  value: string;
  /** Callback when search value changes */
  onChange: (value: string) => void;
  /** Callback when clear button is clicked */
  onClear: () => void;
  /** Placeholder text for search input */
  placeholder?: string;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Ref to the input element */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * Search input component for tables
 *
 * Features:
 * - Search icon
 * - Clear button (when value is present)
 * - Loading spinner (when isLoading is true)
 * - Accessible with aria-busy attribute
 *
 * @example
 * ```tsx
 * <TableSearch
 *   value={searchInput}
 *   onChange={handleSearchChange}
 *   onClear={handleClearSearch}
 *   placeholder="Search users..."
 *   isLoading={loading}
 * />
 * ```
 */
export function TableSearch({
  value,
  onChange,
  onClear,
  placeholder = "Filter records...",
  isLoading = false,
  inputRef,
}: TableSearchProps) {
  return (
    <div className="relative w-full max-w-lg">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-busy={isLoading}
        className="h-10 w-full rounded-none border border-input bg-background pl-10 pr-10 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all"
      />
      {(value || isLoading) && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {isLoading && (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          )}
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded-none hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
