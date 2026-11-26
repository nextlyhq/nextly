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
import { useState, useCallback } from "react";
import type { JSX } from "react";

import { Loader2, Search, X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import {
  useRelationshipSearch,
  type SearchResultItem,
} from "./useRelationshipSearch";

// ============================================================
// Types
// ============================================================

// The item type lives beside the search that answers it; re-exported here,
// where the picker's callers have always imported it.
export type { SearchResultItem } from "./useRelationshipSearch";

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

/** A search still out, or one that failed with a way to ask again. */
function SearchProgress({
  searching,
  failed,
  retry,
}: {
  searching: boolean;
  failed: boolean;
  retry: () => void;
}): JSX.Element | null {
  if (searching) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Searching…
      </div>
    );
  }
  if (!failed) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"
    >
      {"The search couldn't be completed."}
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

/** What an answered search with nothing to offer says. */
function EmptyResults({
  alreadyAdded,
  searched,
}: {
  alreadyAdded: readonly SearchResultItem[];
  searched: boolean;
}): JSX.Element {
  return (
    <p className="text-sm text-muted-foreground text-center py-4">
      {alreadyAdded.length > 0
        ? alreadyAddedWords(alreadyAdded)
        : searched
          ? "No results found"
          : "Type to search..."}
    </p>
  );
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
  const {
    debouncedSearch,
    shownHere,
    answered,
    failed,
    searching,
    hasMore,
    totalDocs,
    isFetching,
    loadMore,
    retry,
  } = useRelationshipSearch(selectedCollection, search, limit);
  // Already-selected entries are not offered again, but are said by name when
  // they are all the search matched.
  const results = shownHere.filter(item => !excludeIds.includes(item.id));
  const alreadyAdded = shownHere.filter(item => excludeIds.includes(item.id));

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
        <SearchProgress searching={searching} failed={failed} retry={retry} />
        {results.length === 0 ? (
          searching || (failed && !answered) ? null : (
            <EmptyResults
              alreadyAdded={alreadyAdded}
              searched={debouncedSearch !== ""}
            />
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
              onClick={loadMore}
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
