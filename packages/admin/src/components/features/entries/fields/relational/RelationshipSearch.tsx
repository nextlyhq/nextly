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

import { Button, Input } from "@nextlyhq/ui";
import { useState, useCallback, useEffect } from "react";
import type { JSX } from "react";

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

/** How many already-added matches the empty message names before counting. */
const ALREADY_ADDED_NAMED = 3;

/**
 * What the list says when every match is already selected: their names, so
 * "No results found" never hides an entry that is already there.
 */
function alreadyAddedWords(items: readonly SearchResultItem[]): string {
  const named = items.slice(0, ALREADY_ADDED_NAMED).map(getItemLabel);
  const more = items.length - named.length;
  return more > 0
    ? `Already added: ${named.join(", ")} and ${String(more)} more`
    : `Already added: ${named.join(", ")}`;
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
 * - Loading state while a search is out, keeping the previous results shown
 * - Empty state message, said only once the search has answered
 * - Excludes already-selected items, and names them when they are all it found
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
}: RelationshipSearchProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [selectedCollection, setSelectedCollection] = useState(collections[0]);
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);
  // Which search the results belong to: a collection and the term sent.
  const searchKey = `${selectedCollection ?? ""}\u0000${debouncedSearch}`;
  // Not `usePagination`, because this list does not paginate: it ACCUMULATES.
  // The page number only ever increments to fetch more, results append to what
  // is already shown, and there is no page size selector and no way back to a
  // previous page. The hook models navigation between pages of a fixed set,
  // which is a different thing that happens to count with the same word.
  // The page is kept with the search it was counted for, so a new term reads
  // its first page, and never another term's page number, with no reset to
  // run first.
  const [paging, setPaging] = useState({ key: searchKey, page: 1 });
  const currentPage = paging.key === searchKey ? paging.page : 1;
  // The results shown, with the search they answer. They stay on screen
  // until the next search answers, so typing never blanks the list. Nothing
  // has answered yet at first, which no search's key matches.
  const [shown, setShown] = useState<{
    key: string;
    items: SearchResultItem[];
  }>({ key: "", items: [] });

  const { data, isLoading, isFetching, isPlaceholderData } = useEntries({
    collectionSlug: selectedCollection,
    params: {
      search: debouncedSearch,
      limit,
      page: currentPage,
      // Editors relate to draft content too, so the picker must not be limited
      // to the REST published-only default — request all statuses.
      status: "all",
    },
    enabled: !!selectedCollection,
  });

  // An answer for this search: its first page replaces what is shown, a later
  // page adds the entries not already shown. A placeholder is the previous
  // search's answer, held while this one loads, so it changes nothing.
  useEffect(() => {
    if (data?.items === undefined || isPlaceholderData) return;
    const items = data.items as SearchResultItem[];
    setShown(previous => {
      if (currentPage === 1 || previous.key !== searchKey) {
        return { key: searchKey, items };
      }
      const existingIds = new Set(previous.items.map(item => item.id));
      return {
        key: searchKey,
        items: [
          ...previous.items,
          ...items.filter(item => !existingIds.has(item.id)),
        ],
      };
    });
  }, [data, isPlaceholderData, currentPage, searchKey]);

  // Another collection's results are never offered: picking one would relate
  // an entry of that collection under this one's slug.
  const shownHere = shown.key.startsWith(`${selectedCollection ?? ""}\u0000`)
    ? shown.items
    : [];
  // Already-selected entries are not offered again, but are said by name when
  // they are all the search matched.
  const results = shownHere.filter(item => !excludeIds.includes(item.id));
  const alreadyAdded = shownHere.filter(item => excludeIds.includes(item.id));

  // Whether the answer for what is typed is still to come: the term is
  // waiting out the debounce, or its first page is not in yet. Until it
  // comes, no empty result is said, since none has been answered. A later
  // page loading is said on its own button instead.
  const answered = shown.key === searchKey;
  const searching = search !== debouncedSearch || !answered || isLoading;

  // Check if there are more pages to load (canonical meta per spec §5.1).
  // While a later page loads, the data held is the page before it, whose
  // answer still stands.
  const hasMore = answered && (data?.meta.hasNext ?? false);
  const totalDocs = data?.meta.total ?? 0;

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      onSelect(item, selectedCollection);
    },
    [onSelect, selectedCollection]
  );

  // The page and the results follow the collection by `searchKey`.
  const handleCollectionChange = useCallback((collection: string) => {
    setSelectedCollection(collection);
  }, []);

  const handleLoadMore = useCallback(() => {
    setPaging({ key: searchKey, page: currentPage + 1 });
  }, [searchKey, currentPage]);

  // The previous results stay until the new term's answer replaces them.
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  return (
    <div
      className={cn(
        "rounded-lg  border border-border bg-card p-4   space-y-4",
        className
      )}
    >
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
              size="md"
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
      <div className="max-h-60 overflow-y-auto space-y-1" aria-busy={searching}>
        {searching ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Searching…
          </div>
        ) : null}
        {results.length === 0 ? (
          searching ? null : (
            <p className="text-sm text-muted-foreground text-center py-4">
              {alreadyAdded.length > 0
                ? alreadyAddedWords(alreadyAdded)
                : debouncedSearch
                  ? "No results found"
                  : "Type to search..."}
            </p>
          )
        ) : (
          results.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className={cn(
                "w-full text-left p-2 rounded-md transition-colors hover-unified",
                "focus:bg-primary/5 focus:outline-none"
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
          ))
        )}

        {/* Load More button, also where every match so far is already added */}
        {hasMore && (
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleLoadMore}
              disabled={isFetching}
              className="w-full"
            >
              {isFetching ? (
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
      </div>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
