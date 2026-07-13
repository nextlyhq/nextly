/**
 * DataTableView — presentational core of the unified table.
 *
 * Controlled and fetch-free: the parent owns data, pagination, search, and (via
 * the `selection` prop) row selection. This is a drop-in replacement for the
 * legacy `ResponsiveTable` on pages that already manage their own state with
 * TanStack Query, so migrating a page never disturbs its data layer or its
 * mutation cache-invalidation.
 *
 * Renders both a desktop table and a responsive card view, switching on the
 * `@container/table` container query (`@md/table:`) so it adapts to its own
 * width rather than the viewport (correct for tables inside variable-width
 * panels). Cells resolve through the field-type registry; row navigation uses
 * the `rowClick` union (string href, void side-effect for dialogs, or select).
 *
 * The batteries-included `DataTable` composes this with search + pagination.
 *
 * @module components/ui/table/data-table/DataTableView
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableEmpty,
  TableError,
  TableLoading,
  Checkbox,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";

import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

import { resolveCellRenderer } from "./cell-registry";
import type { CellContext, NextlyColumn, RowAction, RowClick } from "./types";

/** Controlled selection contract. When supplied, a checkbox column is shown. */
export interface DataTableSelection<
  Row extends object = Record<string, unknown>,
> {
  /** Ids of the currently selected rows (parent-owned). */
  selectedIds: string[];
  /** Toggle a single row. */
  onToggle: (row: Row) => void;
  /** Toggle all rows on the page (`allSelected` = current state before toggle). */
  onToggleAll: (rows: Row[], allSelected: boolean) => void;
  /** Whether a row can be selected (e.g. system roles are locked). Default: all. */
  isSelectable?: (row: Row) => boolean;
}

export interface DataTableViewProps<Row extends object> {
  columns: NextlyColumn<Row>[];
  rows: Row[];
  getRowId?: (row: Row) => string;
  /** Row-click behavior: navigate (string), dialog/side-effect (void), select, or none. */
  rowClick?: RowClick<Row>;
  /** Which column renders as the primary link when `rowClick` yields an href. */
  primaryColumn?: string;
  /** Controlled selection; omit to disable the checkbox column. */
  selection?: DataTableSelection<Row>;
  /** Per-row action menu (three-dots). */
  rowActions?: (row: Row) => RowAction<Row>[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  ariaLabel?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

const DEFAULT_GET_ROW_ID = (row: object): string => {
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
};

export function DataTableView<Row extends object>({
  columns,
  rows,
  getRowId = DEFAULT_GET_ROW_ID,
  rowClick = false,
  primaryColumn,
  selection,
  rowActions,
  loading = false,
  error = null,
  emptyMessage = "No results found.",
  ariaLabel = "Data table",
  className,
}: DataTableViewProps<Row>) {
  const visibleColumns = useMemo(
    () => columns.filter(c => !c.hidden),
    [columns]
  );
  const mobileColumns = useMemo(
    () => visibleColumns.filter(c => !c.hideOnMobile),
    [visibleColumns]
  );
  const firstColName = primaryColumn ?? visibleColumns[0]?.name;

  // Card-view primary/secondary split (skip synthetic select/actions columns).
  const cardPrimary = useMemo(
    () =>
      mobileColumns.find(c => c.name !== "select" && c.name !== "actions") ??
      mobileColumns[0],
    [mobileColumns]
  );
  const cardSecondary = useMemo(
    () => mobileColumns.filter(c => c.name !== cardPrimary?.name),
    [mobileColumns, cardPrimary]
  );

  const selectedSet = useMemo(
    () => new Set(selection?.selectedIds ?? []),
    [selection?.selectedIds]
  );
  const selectableRows = useMemo(
    () =>
      selection ? rows.filter(r => selection.isSelectable?.(r) ?? true) : [],
    [rows, selection]
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every(r => selectedSet.has(getRowId(r)));
  const someSelected =
    selectableRows.some(r => selectedSet.has(getRowId(r))) && !allSelected;

  // Resolve a cell's rendered content: explicit cell -> registry -> text.
  const renderCell = (col: NextlyColumn<Row>, row: Row, href?: string) => {
    const value = col.accessor
      ? col.accessor(row)
      : (row as Record<string, unknown>)[col.name];
    const ctx: CellContext<Row> = {
      value,
      row,
      column: col,
      field: col.field,
      href,
      viewType: "list",
    };
    const renderer = resolveCellRenderer<Row>(col.cell, col.fieldType);
    const content = renderer(ctx);
    // Primary column becomes the navigation link when rowClick yields an href.
    if (href && col.name === firstColName) {
      return (
        <a
          href={href}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            navigateTo(href);
          }}
          className="text-foreground font-medium hover:underline"
        >
          {content}
        </a>
      );
    }
    return content;
  };

  // Per-row navigation: an href (navigate), a void action (dialog), or none.
  const resolveRow = (row: Row): { href?: string; onClick?: () => void } => {
    if (rowClick === false || rowClick === "edit") return {};
    if (rowClick === "select") {
      if (!selection) return {};
      const selectable = selection.isSelectable?.(row) ?? true;
      return selectable ? { onClick: () => selection.onToggle(row) } : {};
    }
    if (typeof rowClick === "function") {
      const result = rowClick(row);
      if (typeof result === "string") return { href: result };
      // returned void -> re-invoke on click (side-effect, e.g. open a dialog).
      return { onClick: () => rowClick(row) };
    }
    return {};
  };

  const renderRowActions = (row: Row) => {
    const actions = (rowActions?.(row) ?? []).filter(
      a => a.isVisible?.(row) ?? true
    );
    if (actions.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Row actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map(a => (
            <DropdownMenuItem
              key={a.id}
              disabled={a.isDisabled?.(row) ?? false}
              onSelect={() => a.onSelect(row)}
              className={cn(a.destructive && "text-destructive")}
            >
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const colSpan =
    visibleColumns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className={cn("@container/table w-full", className)}>
      {error && (
        <div className="mb-3 rounded-none bg-destructive/10 p-3 text-sm text-destructive">
          <TableError message={error} />
        </div>
      )}

      {/* Mobile / narrow: card view */}
      <div className="flex flex-col gap-4 @md/table:hidden">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center">
            <TableLoading />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          rows.map(row => {
            const id = getRowId(row);
            const nav = resolveRow(row);
            const clickable = Boolean(nav.href || nav.onClick);
            const selectable = selection?.isSelectable?.(row) ?? true;
            return (
              <Card
                key={id}
                variant={clickable ? "interactive" : "default"}
                className={cn(clickable && "cursor-pointer")}
                onClick={() => {
                  if (nav.href) navigateTo(nav.href);
                  else nav.onClick?.();
                }}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                  <CardTitle className="text-base">
                    {cardPrimary ? renderCell(cardPrimary, row, nav.href) : id}
                  </CardTitle>
                  <div
                    className="flex items-center gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    {selection && (
                      <Checkbox
                        checked={selectedSet.has(id)}
                        disabled={!selectable}
                        onCheckedChange={() => selection.onToggle(row)}
                        aria-label="Select row"
                      />
                    )}
                    {renderRowActions(row)}
                  </div>
                </CardHeader>
                {cardSecondary.length > 0 && (
                  <CardContent className="pb-3">
                    <dl className="flex flex-col gap-2">
                      {cardSecondary.map(col => (
                        <div
                          key={col.name}
                          className="flex items-start justify-between gap-4 text-sm"
                        >
                          {!col.hideLabelOnMobile && (
                            <dt className="min-w-20 shrink-0 text-muted-foreground">
                              {col.header}
                            </dt>
                          )}
                          <dd
                            className={cn(
                              "flex-1",
                              col.hideLabelOnMobile ? "text-left" : "text-right"
                            )}
                          >
                            {renderCell(col, row, nav.href)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Desktop / wide: table view */}
      <div className="hidden overflow-hidden rounded-none border border-border bg-card text-card-foreground @md/table:block">
        <div className="overflow-x-auto">
          <Table aria-label={ariaLabel} className="w-full">
            <TableHeader>
              <TableRow>
                {selection && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={() =>
                        selection.onToggleAll(selectableRows, allSelected)
                      }
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                {visibleColumns.map(col => (
                  <TableHead
                    key={col.name}
                    className={cn(
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center"
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
                {rowActions && <TableHead className="w-12 text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-24 text-center">
                    <TableLoading />
                  </TableCell>
                </TableRow>
              ) : rows.length > 0 ? (
                rows.map(row => {
                  const id = getRowId(row);
                  const nav = resolveRow(row);
                  const clickable = Boolean(nav.href || nav.onClick);
                  const selectable = selection?.isSelectable?.(row) ?? true;
                  return (
                    <TableRow
                      key={id}
                      data-state={selectedSet.has(id) ? "selected" : undefined}
                      className={cn(
                        "hover-unified-table-row",
                        clickable && "cursor-pointer",
                        selectedSet.has(id) && "bg-muted/50"
                      )}
                      onClick={() => {
                        if (nav.href) navigateTo(nav.href);
                        else nav.onClick?.();
                      }}
                    >
                      {selection && (
                        <TableCell
                          className="w-10"
                          onClick={e => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedSet.has(id)}
                            disabled={!selectable}
                            onCheckedChange={() => selection.onToggle(row)}
                            aria-label="Select row"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.map(col => (
                        <TableCell
                          key={col.name}
                          className={cn(
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center"
                          )}
                        >
                          {renderCell(col, row, nav.href)}
                        </TableCell>
                      ))}
                      {rowActions && (
                        <TableCell
                          className="w-12 text-right"
                          onClick={e => e.stopPropagation()}
                        >
                          {renderRowActions(row)}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-24 text-center">
                    <TableEmpty message={emptyMessage} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
