"use client";

/**
 * Relationship Search Component
 *
 * Provides a search interface for finding and selecting related documents.
 * Supports polymorphic relationships with collection tabs.
 *
 * @module components/entries/fields/relational/RelationshipSearch
 * @since 1.0.0
 */

import { Button, Input } from "@revnixhq/ui";
import { useState, useCallback, useEffect } from "react";

import { Loader2, Search, X } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { useEntries } from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

/**
 * A result item from the search.
 */
export interface SearchResultItem {
  id: string;
  title?: string;
  name?: string;
  label?: string;
  email?: string;
  description?: string;
  [key: string]: unknown;
}

export interface RelationshipSearchProps {
  /**
   * Collection slug(s) to search in.
   * For polymorphic relationships, pass an array of collections.
   */
  collections: string[];

  /**
   * Callback when an item is selected.
   */
  onSelect: (item: SearchResultItem, collectionSlug: string) => void;

  /**
   * Callback to close the search panel.
   */
  onClose: () => void;

  /**
   * IDs to exclude from search results (already selected).
   * @default []
   */
  excludeIds?: string[];

  /**
   * Placeholder text for search input.
   * @default "Search..."
   */
  placeholder?: string;

  /**
   * Maximum results to show.
   * @default 10
   */
  limit?: number;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Extracts a display label from a search result item.
 */
function getItemLabel(item: SearchResultItem): string {
  return item.title || item.name || item.label || item.email || item.id;
}

// ============================================================
// Component
// ============================================================

/**
 * RelationshipSearch provides a search interface for related documents.
 *
 * Features:
 * - Debounced search (300ms) to prevent API flooding
 * - Collection tabs for polymorphic relationships
 * - Loading state with spinner
 * - Empty state message
 * - Excludes already-selected items
 * - Close button to dismiss
 *
 * @example Single collection
 * ```tsx
 * <RelationshipSearch
 *   collections={["users"]}
 *   onSelect={(item) => handleSelect(item)}
 *   onClose={() => setIsOpen(false)}
 *   excludeIds={selectedIds}
 * />
 * ```
 *
 * @example Polymorphic collections
 * ```tsx
 * <RelationshipSearch
 *   collections={["posts", "pages", "products"]}
 *   onSelect={(item, collection) => handleSelect(item, collection)}
 *   onClose={() => setIsOpen(false)}
 * />
 * ```
 */
export function RelationshipSearch({
  collections,
  onSelect,
  onClose,
  excludeIds = [],
  placeholder = "Search...",
  limit = 10,
  className,
}: RelationshipSearchProps) {
  const [search, setSearch] = useState("");
  const [selectedCollection, setSelectedCollection] = useState(collections[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [accumulatedResults, setAccumulatedResults] = useState<
    SearchResultItem[]
  >([]);
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  const { data, isLoading } = useEntries({
    collectionSlug: selectedCollection,
    params: {
      search: debouncedSearch,
      limit,
      page: currentPage,
    },
    enabled: !!selectedCollection,
  });

  // Accumulate results when new data arrives
  useEffect(() => {
    if (data?.docs) {
      if (currentPage === 1) {
        // First page - replace all results
        setAccumulatedResults(data.docs);
      } else {
        // Subsequent pages - append only new results (avoid duplicates)
        setAccumulatedResults(prev => {
          const existingIds = new Set(prev.map(item => item.id));
          const newItems = (data.docs as SearchResultItem[]).filter(
            item => !existingIds.has(item.id)
          );
          return [...prev, ...newItems];
        });
      }
    }
  }, [data, currentPage]);

  // Filter out already selected items
  const results = accumulatedResults.filter(
    item => !excludeIds.includes(item.id)
  );

  // Check if there are more pages to load
  const hasMore = data?.hasNextPage ?? false;
  const totalDocs = data?.totalDocs ?? 0;

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      onSelect(item, selectedCollection);
    },
    [onSelect, selectedCollection]
  );

  const handleCollectionChange = useCallback((collection: string) => {
    setSelectedCollection(collection);
    setCurrentPage(1); // Reset to first page when changing collections
    setAccumulatedResults([]); // Clear accumulated results
    // Optionally clear search when switching collections
    // setSearch("");
  }, []);

  const handleLoadMore = useCallback(() => {
    setCurrentPage(prev => prev + 1);
  }, []);

  // Reset page when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setCurrentPage(1);
    setAccumulatedResults([]); // Clear accumulated results
  }, []);

  return (
    <div className={cn("rounded-none border bg-card p-4   space-y-4", className)}>
      {/* Header with title and close button */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Search Related</h4>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Close search"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Collection tabs for polymorphic relationships */}
      {collections.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {collections.map(col => (
            <Button
              key={col}
              type="button"
              variant={selectedCollection === col ? "default" : "outline"}
              size="sm"
              onClick={() => handleCollectionChange(col)}
              className="capitalize"
            >
              {col}
            </Button>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder}
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          className="pl-8"
          autoFocus
        />
      </div>

      {/* Results list */}
      <div className="max-h-60 overflow-y-auto space-y-1">
        {isLoading && currentPage === 1 ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {debouncedSearch ? "No results found" : "Type to search..."}
          </p>
        ) : (
          <>
            {results.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className={cn(
                  "w-full text-left p-2 rounded-none transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus:bg-accent focus:text-accent-foreground focus:outline-none"
                )}
              >
                <span className="font-medium block whitespace-normal break-words">
                  {getItemLabel(item)}
                </span>
                {item.description && (
                  <span className="text-sm text-muted-foreground block whitespace-normal break-words mt-0.5">
                    {item.description}
                  </span>
                )}
              </button>
            ))}

            {/* Load More button */}
            {hasMore && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-2" />
                      Loading...
                    </>
                  ) : (
                    `Load More (${results.length} of ${totalDocs})`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
