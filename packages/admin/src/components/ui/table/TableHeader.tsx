import {
  TableHead,
  TableHeader as ShadcnTableHeader,
  TableRow,
} from "@revnixhq/ui";
import { flexRender, type Table } from "@tanstack/react-table";

import { ArrowUp, ArrowDown, ChevronsUpDown } from "@admin/components/icons";

/**
 * Props for TableHeader component
 */
export interface TableHeaderProps<TData> {
  /** React Table instance */
  table: Table<TData>;
  /** Whether sorting is enabled */
  enableSorting?: boolean;
}

/**
 * Table header component with sorting support
 *
 * Renders table headers with optional sorting indicators and handlers.
 * Clicking on sortable headers toggles the sort direction.
 *
 * Sort indicators:
 * - ArrowUp = Ascending
 * - ArrowDown = Descending
 * - ChevronsUpDown = Unsorted (sortable)
 *
 * @example
 * ```tsx
 * <Table>
 *   <TableHeaderComponent
 *     table={table}
 *     enableSorting={true}
 *   />
 *   <TableBody>
 *     ...
 *   </TableBody>
 * </Table>
 * ```
 */
export function TableHeaderComponent<TData>({
  table,
  enableSorting = true,
}: TableHeaderProps<TData>) {
  return (
    <ShadcnTableHeader>
      {table.getHeaderGroups().map(headerGroup => (
        <TableRow
          key={headerGroup.id}
          className="bg-[hsl(var(--table-header-bg))] border-border/50"
        >
          {headerGroup.headers.map(header => (
            <TableHead
              key={header.id}
              onClick={
                enableSorting && header.column.getCanSort()
                  ? header.column.getToggleSortingHandler()
                  : undefined
              }
              className={
                enableSorting && header.column.getCanSort()
                  ? "cursor-pointer select-none"
                  : ""
              }
            >
              <div className="flex items-center gap-2">
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext()
                )}
                {enableSorting && header.column.getCanSort() && (
                  <span className="ml-1 opacity-70">
                    {header.column.getIsSorted() === "asc" && (
                      <ArrowUp className="w-3.5 h-3.5 text-foreground" />
                    )}
                    {header.column.getIsSorted() === "desc" && (
                      <ArrowDown className="w-3.5 h-3.5 text-foreground" />
                    )}
                    {!header.column.getIsSorted() && (
                      <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </span>
                )}
              </div>
            </TableHead>
          ))}
        </TableRow>
      ))}
    </ShadcnTableHeader>
  );
}
