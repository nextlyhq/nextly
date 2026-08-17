"use client";

/**
 * The columns control, as one implementation rather than one per surface.
 *
 * This markup previously existed once, inside the entries toolbar, so fifteen
 * of the sixteen admin lists could not hide a column at all — even the four
 * whose toolbar already declared a slot shaped for it. Lifting it here is what
 * makes the control available to a surface that wants it.
 *
 * @module components/ui/table/list-view/ListColumnsMenu
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

import { Columns, RotateCcw } from "@admin/components/icons";

import type { ListColumnsControl } from "./types";

/**
 * A column's menu label. `header` is a `ReactNode` so it may be an element
 * (a sortable header, an icon); only a string is meaningful as a label, and
 * the column's `name` is the stable fallback.
 */
function columnLabel<Row extends object>(
  column: ListColumnsControl<Row>["columns"][number]
): string {
  return typeof column.header === "string" ? column.header : column.name;
}

export function ListColumnsMenu<Row extends object>({
  columns,
  isColumnVisible,
  onToggleColumn,
  onReset,
}: ListColumnsControl<Row>) {
  return (
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
              {columnLabel(column)}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {onReset && columns.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              size="md"
              className="w-full justify-start px-2 font-normal"
              onClick={onReset}
            >
              <RotateCcw className="h-4 w-4" />
              Reset to default
            </Button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
