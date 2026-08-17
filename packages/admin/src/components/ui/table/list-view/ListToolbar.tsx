"use client";

/**
 * The one toolbar above an admin list.
 *
 * It replaces four arrangements that disagreed on both spacing and search
 * width. The measurements it settles, and why each is the value it is:
 *
 * - the search field is capped, and the cap steps with the CONTENT container
 *   rather than the viewport. Both sidebars together take ~328px, so a viewport
 *   breakpoint promises a row the toolbar does not have room for. The two
 *   surfaces that got this right already used `@lg/content`.
 * - controls sit at the end of the row, and stretch to fill it only while the
 *   container is too narrow to place them beside the field.
 * - the filter control carries a dot while any filter is applied, because a
 *   collapsed dropdown otherwise gives no indication that the list is filtered.
 *
 * @module components/ui/table/list-view/ListToolbar
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { ReactNode } from "react";

import { Filter } from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";

import { ListColumnsMenu } from "./ListColumnsMenu";
import type { ListColumnsControl, ListSearch } from "./types";

export interface ListToolbarProps<Row extends object> {
  search?: ListSearch;
  /** Filter controls, rendered inside the toolbar's filter dropdown. */
  filters?: ReactNode;
  /** Drives the filter control's applied-state dot. */
  hasActiveFilters?: boolean;
  columnsControl?: ListColumnsControl<Row>;
  /** Buttons that act on the list as a whole, placed after the controls. */
  actions?: ReactNode;
}

/**
 * True when the toolbar would draw nothing. Rendering an empty flex row still
 * contributes its gap to the column above the table, which is the shape of the
 * stray spacing this component exists to remove.
 */
export function isToolbarEmpty<Row extends object>({
  search,
  filters,
  columnsControl,
  actions,
}: ListToolbarProps<Row>): boolean {
  return !search && !filters && !columnsControl && !actions;
}

export function ListToolbar<Row extends object>({
  search,
  filters,
  hasActiveFilters,
  columnsControl,
  actions,
}: ListToolbarProps<Row>) {
  const hasControls = Boolean(filters || columnsControl || actions);

  return (
    // Named so its PRESENCE is observable. The failure this component guards
    // against is an empty toolbar row still contributing its gap to the column
    // above the table — and an empty row and an absent one are identical when
    // you look for the controls that would have been inside it.
    <div
      data-slot="list-toolbar"
      className="flex flex-col justify-between gap-4 @lg/content:flex-row @lg/content:items-center"
    >
      {search && (
        <div className="relative w-full @lg/content:max-w-xs @2xl/content:max-w-sm">
          <SearchBar
            value={search.value}
            onChange={search.onChange}
            placeholder={search.placeholder}
            isLoading={search.isLoading}
            className="w-full"
            {...search.inputProps}
          />
        </div>
      )}

      {hasControls && (
        <div className="flex flex-wrap items-center gap-2 @lg/content:justify-end">
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
                    // A fixed circle rather than a `--radius` step: this is a
                    // dot, so it stays round at every radius setting.
                    <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-full bg-primary" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {filters}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {columnsControl && <ListColumnsMenu {...columnsControl} />}

          {actions}
        </div>
      )}
    </div>
  );
}
