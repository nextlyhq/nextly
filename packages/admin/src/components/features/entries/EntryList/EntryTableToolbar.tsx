/**
 * Entry Table Toolbar Component
 *
 * Provides search, filters, and column visibility controls for the entry table.
 *
 * @module components/entries/EntryList/EntryTableToolbar
 * @since 1.0.0
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type React from "react";

import { Columns, RotateCcw, Filter } from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";

import type { CollectionForColumns } from "./EntryTableColumns";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryTableToolbar component.
 */
export interface EntryTableToolbarProps {
  /** Collection configuration */
  collection: CollectionForColumns;
  /** The table's columns (used to populate the visibility toggle). */
  columns: NextlyColumn<Record<string, unknown>>[];
  /** Whether a column is currently visible. */
  isColumnVisible: (name: string) => boolean;
  /** Toggle a column's visibility. */
  onToggleColumn: (name: string) => void;
  /** Current global filter value */
  globalFilter: string;
  /** Callback when global filter changes */
  onGlobalFilterChange: (value: string) => void;
  /** Callback to reset column visibility to defaults (optional) */
  onResetColumnVisibility?: () => void;
  /** Custom filter components to render in the toolbar (optional) */
  filters?: React.ReactNode;
  /** Whether any filters are currently active (optional) */
  hasActiveFilters?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Toolbar for entry table with search and column visibility controls.
 */
export function EntryTableToolbar({
  collection,
  columns,
  isColumnVisible,
  onToggleColumn,
  globalFilter,
  onGlobalFilterChange,
  onResetColumnVisibility,
  filters,
  hasActiveFilters,
}: EntryTableToolbarProps) {
  const getColumnDisplayName = (
    column: NextlyColumn<Record<string, unknown>>
  ) => (typeof column.header === "string" ? column.header : column.name);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-4 @lg/content:flex-row @lg/content:items-center">
        {/* Search Input */}
        <div className="relative w-full @lg/content:max-w-xs @2xl/content:max-w-sm">
          <SearchBar
            value={globalFilter}
            onChange={onGlobalFilterChange}
            placeholder={`Search ${collection.label}...`}
            className="w-full border-border bg-background text-foreground"
            data-entry-search-input
          />
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2 @lg/content:justify-end">
          {/* Custom Filters (e.g. Status) */}
          {filters && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="md"
                  className="relative flex-1 border-border bg-background text-foreground hover-unified hover:bg-accent/10 @lg/content:flex-none"
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  {hasActiveFilters && (
                    <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-none bg-primary" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {filters}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Column Visibility Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="flex-1 border-border bg-background text-foreground hover-unified hover:bg-accent/10 @lg/content:flex-none"
              >
                <Columns className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  No columns to toggle
                </p>
              ) : (
                columns.map(column => (
                  <DropdownMenuCheckboxItem
                    key={column.name}
                    checked={isColumnVisible(column.name)}
                    onCheckedChange={() => onToggleColumn(column.name)}
                  >
                    {getColumnDisplayName(column)}
                  </DropdownMenuCheckboxItem>
                ))
              )}
              {onResetColumnVisibility && columns.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <Button
                    variant="ghost"
                    size="md"
                    className="w-full justify-start px-2 font-normal"
                    onClick={onResetColumnVisibility}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset to default
                  </Button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
