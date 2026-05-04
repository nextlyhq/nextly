/**
 * Entry Table Toolbar Component
 *
 * Provides search, query presets, export, and column visibility controls for the entry table.
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
} from "@revnixhq/ui";
import type { Table } from "@tanstack/react-table";
import type React from "react";

import { Columns, RotateCcw, Filter } from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";

import type { CollectionForColumns } from "./EntryTableColumns";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryTableToolbar component.
 */
export interface EntryTableToolbarProps {
  /** TanStack Table instance */
  table: Table<Record<string, unknown>>;
  /** Collection configuration */
  collection: CollectionForColumns;
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
// Constants
// ============================================================================

/**
 * Column IDs that should not appear in the column visibility dropdown.
 * These are structural columns (selection, actions) that should always be visible.
 * Additionally, core fields like title, slug, and id are excluded from toggling
 * so they remain fixed in the table.
 */
const HIDDEN_FROM_COLUMN_TOGGLE = new Set(["select", "actions"]);

/**
 * Friendly display names for built-in columns.
 */
const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  id: "ID",
  createdAt: "Created At",
  updatedAt: "Updated At",
};

// ============================================================================
// Component
// ============================================================================

/**
 * Toolbar for entry table with search and column visibility controls.
 *
 * Features:
 * - Global search input with clear button
 * - Query presets for saving/loading view states
 * - Column visibility toggle dropdown
 *
 * @param props - Toolbar props
 * @returns Toolbar component
 *
 * @example
 * ```tsx
 * <EntryTableToolbar
 *   table={table}
 *   collection={collection}
 *   globalFilter={globalFilter}
 *   onGlobalFilterChange={handleGlobalFilterChange}
 * />
 * ```
 */
export function EntryTableToolbar({
  table,
  collection,
  globalFilter,
  onGlobalFilterChange,
  onResetColumnVisibility,
  filters,
  hasActiveFilters,
}: EntryTableToolbarProps) {
  // Get columns that can be toggled (exclude select and actions)
  const toggleableColumns = table
    .getAllColumns()
    .filter(
      column => column.getCanHide() && !HIDDEN_FROM_COLUMN_TOGGLE.has(column.id)
    );

  // Get display name for a column
  const getColumnDisplayName = (columnId: string): string => {
    // Check built-in names first
    if (COLUMN_DISPLAY_NAMES[columnId]) {
      return COLUMN_DISPLAY_NAMES[columnId];
    }

    // Try to get label from collection fields
    const field = collection.fields.find(
      f => "name" in f && f.name === columnId
    );
    if (field && "label" in field && field.label) {
      return field.label;
    }

    // Capitalize the column ID as fallback
    return columnId.charAt(0).toUpperCase() + columnId.slice(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative w-full sm:max-w-xs md:max-w-sm">
          <SearchBar
            value={globalFilter}
            onChange={onGlobalFilterChange}
            placeholder={`Search ${collection.label}...`}
            className="w-full bg-background text-foreground border-primary/5"
            data-entry-search-input
          />
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {/* Custom Filters (e.g. Status) */}
          {filters && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="md"
                  className="relative flex-1 sm:flex-none hover-unified bg-background text-foreground border-primary/5 hover:bg-accent/10"
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  {hasActiveFilters && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3 rounded-none bg-primary" />
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
                className="flex-1 sm:flex-none hover-unified bg-background text-foreground border-primary/5 hover:bg-accent/10"
              >
                <Columns className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  No columns to toggle
                </p>
              ) : (
                toggleableColumns.map(column => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={value => column.toggleVisibility(!!value)}
                  >
                    {getColumnDisplayName(column.id)}
                  </DropdownMenuCheckboxItem>
                ))
              )}
              {onResetColumnVisibility && toggleableColumns.length > 0 && (
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
