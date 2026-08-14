/**
 * DataTableView — presentational core of the unified table.
 *
 * Controlled and fetch-free: the parent owns data, pagination, search, and (via
 * the `selection` prop) row selection. Pages that already manage their own state
 * with TanStack Query can adopt it without disturbing their data layer or their
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
import { useMemo, type KeyboardEvent } from "react";

import { Pagination } from "@admin/components/shared/pagination";
import type { PaginationProps } from "@admin/components/shared/pagination/types";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

import { resolveCellRenderer } from "./cell-registry";
import { getPluginRowActions, resolvePluginColumns } from "./plugin-registry";
import type { CellContext, NextlyColumn, RowAction } from "./types";

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
  /**
   * Pure resolver for a row's navigation href. When it returns a string, the
   * whole row navigates there and the primary column renders as a link. Must be
   * side-effect free (it runs during render).
   */
  rowHref?: (row: Row) => string | undefined;
  /**
   * Side-effect handler for a row click (e.g. open a dialog). Runs only on click,
   * and only when `rowHref` did not yield an href for that row.
   */
  onRowClick?: (row: Row) => void;
  /** Which column renders as the primary link when `rowHref` yields an href. */
  primaryColumn?: string;
  /** Controlled selection; omit to disable the checkbox column. */
  selection?: DataTableSelection<Row>;
  /** Per-row action menu (three-dots). */
  rowActions?: (row: Row) => RowAction<Row>[];
  /** Current sort (column name + direction). Enables sort indicators on headers. */
  sort?: { field: string; order: "asc" | "desc" };
  /** Called when a sortable column header is clicked. Sorting is server-side. */
  onSortChange?: (field: string, order: "asc" | "desc") => void;
  /**
   * List key for plugin contributions (columns, transforms, row actions).
   * When set, plugin-registered columns/actions for this key and `"*"` are
   * merged in. Examples: a collection slug, `"users"`, `"media"`.
   */
  registryKey?: string;
  loading?: boolean;
  error?: string | null;
  /**
   * Rendered below the rows, normally pagination.
   *
   * Mounted ONCE, inside the surface that holds both views, so a stateful
   * footer keeps one instance and its controls keep unique ids. Rendering it
   * per view and letting CSS hide one would run every effect twice and hand the
   * user a different instance on resize.
   *
   * It belongs here rather than in a wrapper because its placement depends on
   * which view is showing, and this component is the only one that knows. A
   * wrapper would have to ask a second container query, and its box is wider
   * than this one by the card's border, so the two disagree across a
   * two-pixel band.
   */
  footer?: React.ReactNode;
  /**
   * The list's pagination, as DATA rather than markup.
   *
   * This is how a table paginates. The placement of a pager depends on which
   * view is showing and this component is the only one that knows, so it owns
   * where the pager lands as well as when — and a caller that hands over
   * `currentPage` and `onPageChange` has no opportunity to put it anywhere.
   * Passing the pager as markup left that decision at the call site, where the
   * wrong arrangement is the one you get by writing the markup in reading
   * order, and several surfaces drifted into it.
   *
   * Typed as the pager's own props rather than a restatement of them, so a prop
   * added there is available here without a second definition to keep in step.
   */
  pagination?: PaginationProps;
  emptyMessage?: string;
  ariaLabel?: string;
  /** Draw the desktop table's card border. Disable when a parent supplies one. */
  bordered?: boolean;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

const DEFAULT_GET_ROW_ID = (row: object): string => {
  const id = (row as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }
  // Collapsing ID-less rows to "" produces duplicate React keys and merges their
  // selection state. Require a real id or an explicit getRowId instead.
  throw new Error("DataTableView rows require an id or a custom getRowId.");
};

export function DataTableView<Row extends object>({
  columns,
  rows,
  getRowId = DEFAULT_GET_ROW_ID,
  rowHref,
  onRowClick,
  primaryColumn,
  selection,
  rowActions,
  sort,
  onSortChange,
  registryKey,
  loading = false,
  error = null,
  footer,
  pagination,
  emptyMessage = "No results found.",
  ariaLabel = "Data table",
  bordered = true,
  className,
}: DataTableViewProps<Row>) {
  // Merge plugin-contributed columns (and transforms) for this list, if any.
  const resolvedColumns = useMemo(
    () => (registryKey ? resolvePluginColumns(registryKey, columns) : columns),
    [registryKey, columns]
  );
  const pluginRowActions = useMemo(
    () => (registryKey ? getPluginRowActions<Row>(registryKey) : []),
    [registryKey]
  );

  const visibleColumns = useMemo(
    () => resolvedColumns.filter(c => !c.hidden),
    [resolvedColumns]
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

  // Per-row navigation: a pure href (navigate + anchor) or a click side-effect.
  // rowHref runs during render, so it must stay side-effect free; onRowClick only
  // ever runs on an actual click.
  const resolveRow = (row: Row): { href?: string; onClick?: () => void } => {
    const href = rowHref?.(row);
    if (href) return { href };
    if (onRowClick) return { onClick: () => onRowClick(row) };
    return {};
  };

  // Activate a mouse-only control from the keyboard (Enter/Space) so clickable
  // rows/cards and sortable headers are operable without a pointer.
  const onActivateKey = (fn: () => void) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  const activateRow = (nav: { href?: string; onClick?: () => void }) => () => {
    if (nav.href) navigateTo(nav.href);
    else nav.onClick?.();
  };

  const hasRowActions = Boolean(rowActions) || pluginRowActions.length > 0;

  // A plugin-provided `isVisible` predicate that throws must not crash the whole
  // table; isolate each call and hide the action if it throws.
  const isActionVisible = (action: RowAction<Row>, row: Row): boolean => {
    if (!action.isVisible) return true;
    try {
      return action.isVisible(row);
    } catch (err) {
      console.warn(
        `[DataTableView] row action "${action.id}" isVisible threw; hiding it.`,
        err
      );
      return false;
    }
  };

  const renderRowActions = (row: Row) => {
    const actions = [...(rowActions?.(row) ?? []), ...pluginRowActions].filter(
      a => isActionVisible(a, row)
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
    visibleColumns.length + (selection ? 1 : 0) + (hasRowActions ? 1 : 0);

  // The surface that holds the views and the footer, defined once because BOTH
  // return paths below render a footer into it. Written out in each branch, the
  // error path silently lost the card, the clipping and the breakpoint gap, so
  // a pager that is correctly placed in the normal state moved outside the card
  // the moment a request failed -- the exact defect this component's `footer`
  // exists to prevent.
  // What the footer slot holds, resolved ONCE for both return paths. Deciding
  // it separately per branch is how the error path lost the surface: two
  // answers to one question, agreeing until one of them was edited.
  //
  // Both render, footer first. An earlier version let `pagination` win and
  // dropped `footer`, on the reasoning that two pagers in one slot is not a
  // composition anyone wants -- but `footer` is an arbitrary node, not a pager.
  // A caller using it for a selection summary or bulk actions and then adopting
  // `pagination` lost that content silently, with both props public, both
  // permitted by the type, and nothing reporting the loss. A summary above its
  // pager is a real arrangement, so it is the one this renders.
  // Whether the caller's footer will put anything on screen, decided by REACT's
  // rule rather than by JavaScript's. The two disagree in both directions and
  // each disagreement is a real defect:
  //
  //   truthiness  drops `0`, which React renders as "0" -- so a caller passing
  //               `selectedIds.length` with nothing selected loses its footer;
  //   nullishness keeps `false`, which React renders as nothing -- so the
  //               ubiquitous `footer={show && <Summary />}` draws an empty
  //               bordered surface under the table when `show` is false.
  //
  // React renders nothing for `null`, `undefined` and booleans, and renders
  // numbers and strings. That set is closed and defined by React, which is what
  // separates listing it here from guessing at values.
  const footerRendersNothing =
    footer === null ||
    footer === undefined ||
    typeof footer === "boolean" ||
    footer === "";

  // The limit worth stating rather than hiding: a component that RETURNS null
  // still counts as content here, because no inspection of the node can know
  // what it renders without rendering it. That case draws an empty surface, and
  // the fix for it belongs at the caller, which knows.
  const footerContent =
    !footerRendersNothing || pagination !== undefined ? (
      <>
        {footer}
        {pagination !== undefined && <Pagination {...pagination} />}
      </>
    ) : undefined;

  const surfaceClassName = cn(
    // Clipping is NOT part of the card. The table view rounds its own
    // corners through whatever encloses it, and a globally coloured
    // <thead> paints square corners through a rounded parent that does
    // not clip -- which the shared DataTable is, and it is the caller
    // that passes bordered={false}. So this stays unconditional.
    "flex flex-col gap-4 @md/table:block @md/table:gap-0 @md/table:overflow-hidden",
    bordered &&
      "@md/table:rounded-md @md/table:border @md/table:border-border @md/table:bg-card @md/table:text-card-foreground"
  );

  // A failed request and an empty result are different facts, and only one of
  // them can be true. Rendering the table anyway pairs "could not load" with
  // "no users available", which states as data what is actually the absence of
  // an answer. Rows that survive an earlier fetch are still worth showing, so
  // only the row-less case replaces the table outright.
  if (error && rows.length === 0) {
    return (
      <div className={cn("@container/table w-full space-y-4", className)}>
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <TableError message={error} />
        </div>
        {/* The footer stays, and stays in the SAME surface it occupies when the
            request succeeds. It carries the pager, and a request that failed
            for ONE page leaves the user on that page with no rows -- so
            removing the controls here removes the only way back to a page that
            works. The rows are gone; the navigation out of the failure is not
            part of the failure, and neither is its placement. */}
        {footerContent && (
          <div className={surfaceClassName}>{footerContent}</div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("@container/table w-full", className)}>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <TableError message={error} />
        </div>
      )}

      {/* One surface holds both views and the footer.
          Gated on the same container the views read, so the card and the view
          it encloses can never disagree. Below the breakpoint it is a plain
          column: the row cards carry their own borders and the footer takes the
          column's gap. At and above it, it becomes the card and the footer sits
          inside as the table's own footer. */}
      <div className={surfaceClassName}>
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
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={activateRow(nav)}
                  onKeyDown={
                    clickable ? onActivateKey(activateRow(nav)) : undefined
                  }
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                    <CardTitle className="text-base">
                      {cardPrimary
                        ? renderCell(cardPrimary, row, nav.href)
                        : id}
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
                                col.hideLabelOnMobile
                                  ? "text-left"
                                  : "text-right"
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
        <div className="hidden @md/table:block">
          <div className="overflow-x-auto">
            <Table aria-label={ariaLabel} className="w-full min-w-max">
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
                  {visibleColumns.map(col => {
                    const canSort = Boolean(col.sortable && onSortChange);
                    const sorted = sort?.field === col.name ? sort.order : null;
                    return (
                      <TableHead
                        key={col.name}
                        className={cn(
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          canSort && "cursor-pointer select-none"
                        )}
                        role={canSort ? "button" : undefined}
                        tabIndex={canSort ? 0 : undefined}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : canSort
                                ? "none"
                                : undefined
                        }
                        onClick={
                          canSort
                            ? () =>
                                onSortChange?.(
                                  col.name,
                                  sorted === "asc" ? "desc" : "asc"
                                )
                            : undefined
                        }
                        onKeyDown={
                          canSort
                            ? onActivateKey(() =>
                                onSortChange?.(
                                  col.name,
                                  sorted === "asc" ? "desc" : "asc"
                                )
                              )
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            col.align === "right" && "flex-row-reverse",
                            col.align === "center" && "justify-center"
                          )}
                        >
                          {col.header}
                          {sorted && (
                            <span className="text-muted-foreground">
                              {sorted === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                  {hasRowActions && <TableHead className="w-12 text-right" />}
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
                        data-state={
                          selectedSet.has(id) ? "selected" : undefined
                        }
                        className={cn(
                          "hover-unified-table-row",
                          clickable && "cursor-pointer",
                          selectedSet.has(id) && "bg-muted/50"
                        )}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={activateRow(nav)}
                        onKeyDown={
                          clickable
                            ? onActivateKey(activateRow(nav))
                            : undefined
                        }
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
                        {hasRowActions && (
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
        {footerContent}
      </div>
    </div>
  );
}
