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
import {
  Fragment,
  createContext,
  useContext,
  useId,
  useMemo,
  useSyncExternalStore,
  type Context,
  type JSX,
  type ReactNode,
} from "react";

import { ChevronRight } from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import type { PaginationProps } from "@admin/components/shared/pagination/types";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

import { resolveCellRenderer } from "./cell-registry";
import {
  dataTablePluginRegistrations,
  getPluginRowActions,
  resolvePluginColumns,
  subscribeToDataTablePlugins,
  type DataTablePluginRegistrations,
} from "./plugin-registry";
import {
  FIXED_LAYOUT_TABLE,
  fixedColumnLayout,
  ROW_ACTIONS_COLUMN,
  ROW_ACTIONS_TRIGGER,
  SELECTION_COLUMN,
} from "./row-actions";
import {
  isListEmpty,
  rowCountLabel,
  sectionRows,
  useToggledIds,
  type PlacedRow,
  type RowSection,
} from "./row-groups";
import type {
  CellContext,
  DataTableGroup,
  DataTableGrouping,
  DataTableRowDetail,
  NextlyColumn,
  RowAction,
} from "./types";

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
  /**
   * Draw the rows in groups, each under a header row with its title, a badge,
   * a count and actions. In the table each group is its own row group, named
   * by its title; in the narrow card view, a section.
   */
  grouping?: DataTableGrouping<Row>;
  /**
   * A region below a row, opened and closed by a toggle in the row's first
   * column: a button that says whether the region is open and names it.
   */
  rowDetail?: DataTableRowDetail<Row>;
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

/**
 * The plugins' registrations as a parent of the view already holds them,
 * subscribed. `DataTable` draws plugin contributions of its own beside the
 * view (the selection bar's bulk actions) and provides its snapshot here, so
 * the bar and the view read one snapshot and redraw together when a plugin
 * registers while the list is on screen. Internal: not part of the view's
 * props, so it is no surface a plugin could hand a stale value through.
 */
export const HeldPluginRegistrations: Context<
  DataTablePluginRegistrations | undefined
> = createContext<DataTablePluginRegistrations | undefined>(undefined);

/** A subscription that is never told anything, for a snapshot held above. */
function noSubscription(): () => void {
  return () => {};
}

/**
 * The plugins' registrations, read again when one changes, so a column or
 * action registered while a list is on screen joins it. Inside a parent that
 * holds them (`HeldPluginRegistrations`) its snapshot is used as it is and
 * nothing subscribes here: the parent's redraw carries the change to both.
 */
export function useDataTablePluginRegistrations(): DataTablePluginRegistrations {
  const held = useContext(HeldPluginRegistrations);
  const read = held === undefined ? dataTablePluginRegistrations : () => held;
  return useSyncExternalStore(
    held === undefined ? subscribeToDataTablePlugins : noSubscription,
    read,
    read
  );
}

/** Where a row leads: a page to open, or a handler a click runs. */
interface RowNavigation {
  href?: string;
  onClick?: () => void;
}

/**
 * The focus ring of a row's way in, the one the shared Button draws, so the
 * keyboard's position in a list reads like it does on any other control.
 */
const ROW_ENTRY_FOCUS =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * `py-0.5 -my-0.5` gives the way in a 24px-tall target around 20px text, the
 * minimum WCAG 2.5.8 asks of a pointer target, while its margin box keeps the
 * text's height: the row is drawn exactly as tall as before.
 */
const ROW_ENTRY_HIT_AREA = "py-0.5 -my-0.5";

/**
 * A row's way in: its primary cell as a link to the row's page, or as a button
 * running the row's click handler, or as it is when the row leads nowhere.
 *
 * The row and the card are NOT themselves focusable or given a role. They hold
 * other controls (the selection box, the actions menu), and a control inside a
 * control is announced as one and cannot be reached as the other. This element
 * is the keyboard's one way to the row; a pointer may still click anywhere on
 * the row, which runs the same navigation without being a second target.
 * `data-row-entry` lets a page find it again, to return focus to the row.
 */
function RowEntry({
  nav,
  children,
}: {
  nav: RowNavigation;
  children: ReactNode;
}): JSX.Element {
  const { href, onClick } = nav;
  if (href) {
    return (
      <a
        href={href}
        data-row-entry=""
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          navigateTo(href);
        }}
        className={cn(
          // A block as wide as its text, not an inline-block: an inline-block
          // in a table cell sits on the cell's line by its own baseline and
          // drew the title above the row's other cells.
          "block w-fit max-w-full text-foreground font-medium hover:underline",
          ROW_ENTRY_HIT_AREA,
          ROW_ENTRY_FOCUS
        )}
      >
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        data-row-entry=""
        onClick={e => {
          e.stopPropagation();
          onClick();
        }}
        // Drawn as the cell it replaces: block and full width as the cell's
        // content was, aligned and cased as the cell says (a button centres
        // its text by default).
        className={cn(
          "block w-full cursor-pointer [text-align:inherit] [text-transform:inherit]",
          ROW_ENTRY_HIT_AREA,
          ROW_ENTRY_FOCUS
        )}
      >
        {children}
      </button>
    );
  }
  return <>{children}</>;
}

/**
 * A header's `aria-sort`: the order of the sorted column, `none` on a column
 * that can be sorted but is not, and nothing on one that cannot be sorted.
 * The header cell keeps its native `columnheader` role, the only role besides
 * `rowheader` that may carry the attribute.
 */
function ariaSortOf(
  sorted: "asc" | "desc" | null,
  canSort: boolean
): "ascending" | "descending" | "none" | undefined {
  if (sorted) return sorted === "asc" ? "ascending" : "descending";
  return canSort ? "none" : undefined;
}

/**
 * A header's label, and for a sortable column the button that sorts it. The
 * button sits inside the header cell rather than the cell becoming one, so
 * the cell stays a column header and its sort state stays announced. Its
 * `after:` layer spans the cell (which is `relative`), so a click anywhere on
 * the header still sorts, as it did when the whole cell was the control.
 */
function HeaderLabel({
  label,
  sorted,
  align,
  onSort,
}: {
  label: ReactNode;
  sorted: "asc" | "desc" | null;
  align: NextlyColumn<object>["align"];
  onSort?: () => void;
}): JSX.Element {
  const layout = cn(
    "inline-flex items-center gap-1",
    align === "right" && "flex-row-reverse",
    align === "center" && "justify-center"
  );
  const content = (
    <>
      {label}
      {sorted && (
        <span className="text-muted-foreground">
          {sorted === "asc" ? "↑" : "↓"}
        </span>
      )}
    </>
  );
  if (!onSort) return <span className={layout}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        layout,
        "cursor-pointer select-none [text-transform:inherit] after:absolute after:inset-0",
        ROW_ENTRY_FOCUS
      )}
    >
      {content}
    </button>
  );
}

/**
 * The chevron of a toggle: pointing right while what it controls is hidden,
 * down while it is shown. A picture only; the button's `aria-expanded` is what
 * says the state.
 */
function ToggleChevron({ open }: { open: boolean }): JSX.Element {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        "h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none",
        open && "rotate-90"
      )}
    />
  );
}

/**
 * A group's header content, the same in the table and the card view: its
 * title (inside the button that folds the group, when it folds), its badge,
 * its count, its actions at the end, and its description below. `titleId` is
 * what names the group, so it sits on the title alone rather than on the whole
 * header, which would read the actions' text into the group's name.
 */
function GroupHeading({
  group,
  rowCount,
  titleId,
  fold,
}: {
  group: DataTableGroup;
  rowCount: number;
  titleId: string;
  /** The fold button's state and target, when the group can fold. */
  fold?: { open: boolean; controls: string; onToggle: () => void };
}): JSX.Element {
  const title = (
    <span id={titleId} className="font-semibold text-foreground">
      {group.title}
    </span>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {fold ? (
          <button
            type="button"
            aria-expanded={fold.open}
            aria-controls={fold.controls}
            onClick={fold.onToggle}
            className={cn(
              "-ml-1 inline-flex min-h-6 cursor-pointer items-center gap-1.5 px-1 text-left",
              ROW_ENTRY_FOCUS
            )}
          >
            <ToggleChevron open={fold.open} />
            {title}
          </button>
        ) : (
          title
        )}
        {group.badge}
        <span className="text-sm text-muted-foreground">
          {group.count ?? rowCountLabel(rowCount)}
        </span>
        {group.actions && (
          <div className="ml-auto flex items-center gap-2">{group.actions}</div>
        )}
      </div>
      {group.description && (
        <p className="text-sm font-normal text-muted-foreground">
          {group.description}
        </p>
      )}
    </div>
  );
}

/**
 * The button that opens a row's region. Its name is "Details" followed by the
 * row's identifying cell (`nameId`), so each row's toggle is told apart, or
 * the page's own `label`; `aria-expanded` says whether the region is open and
 * `aria-controls` points at it. A click stays on the button: it never runs the
 * row's way in.
 */
function DetailToggle({
  open,
  controls,
  nameId,
  label,
  onToggle,
  visibleText = false,
}: {
  open: boolean;
  controls: string;
  nameId: string;
  label?: string;
  onToggle: () => void;
  /** Whether "Details" is shown beside the chevron, as in a row card. */
  visibleText?: boolean;
}): JSX.Element {
  const textId = `${controls}-toggle`;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      aria-labelledby={label ? undefined : `${textId} ${nameId}`}
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground",
        ROW_ENTRY_FOCUS
      )}
    >
      <ToggleChevron open={open} />
      <span id={textId} className={cn(!visibleText && "sr-only")}>
        Details
      </span>
    </button>
  );
}

/**
 * Takes the bottom border off the last row a body SHOWS. The table primitive
 * flattens its last row, but a body can end in rows that are hidden (a closed
 * row's region, a folded group's rows), and the row above them then drew a
 * second line against the card's border.
 */
const LAST_SHOWN_ROW_FLAT = "[&>tr:not(:has(~tr:not([hidden])))]:border-b-0";

export function DataTableView<Row extends object>({
  columns,
  rows,
  getRowId = DEFAULT_GET_ROW_ID,
  rowHref,
  onRowClick,
  primaryColumn,
  selection,
  rowActions,
  grouping,
  rowDetail,
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
}: DataTableViewProps<Row>): JSX.Element {
  // The plugins' registrations as they stand, read again when one changes, so
  // a column or action registered while this list is on screen joins it.
  const registered = useDataTablePluginRegistrations();
  // Merge plugin-contributed columns (and transforms) for this list, if any.
  const resolvedColumns = useMemo(
    () =>
      registryKey
        ? resolvePluginColumns(registryKey, columns, registered)
        : columns,
    [registryKey, columns, registered]
  );
  const pluginRowActions = useMemo(
    () =>
      registryKey ? getPluginRowActions<Row>(registryKey, registered) : [],
    [registryKey, registered]
  );

  const visibleColumns = useMemo(
    () => resolvedColumns.filter(c => !c.hidden),
    [resolvedColumns]
  );
  // Laid out by the columns' widths where every column declares one, so
  // the columns do not move as rows arrive; else by their content.
  const fixedLayout = fixedColumnLayout(visibleColumns.map(c => c.width));
  const mobileColumns = useMemo(
    () => visibleColumns.filter(c => !c.hideOnMobile),
    [visibleColumns]
  );
  // The column holding each row's way in. A primary column that is not shown
  // falls back to the first shown one, so a row is never left without it.
  const firstColName =
    visibleColumns.find(c => c.name === primaryColumn)?.name ??
    visibleColumns[0]?.name;

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

  // Resolve a cell's rendered content: explicit cell -> registry -> text. The
  // cell holding the row's way in (`asEntry`) is wrapped in it.
  const renderCell = (
    col: NextlyColumn<Row>,
    row: Row,
    nav: RowNavigation,
    asEntry: boolean
  ) => {
    const value = col.accessor
      ? col.accessor(row)
      : (row as Record<string, unknown>)[col.name];
    const ctx: CellContext<Row> = {
      value,
      row,
      column: col,
      field: col.field,
      href: nav.href,
      viewType: "list",
    };
    const renderer = resolveCellRenderer<Row>(col.cell, col.fieldType);
    const content = renderer(ctx);
    if (!asEntry) return content;
    return <RowEntry nav={nav}>{content}</RowEntry>;
  };

  // Per-row navigation: a pure href (navigate + anchor) or a click side-effect.
  // rowHref runs during render, so it must stay side-effect free; onRowClick only
  // ever runs on an actual click.
  const resolveRow = (row: Row): RowNavigation => {
    const href = rowHref?.(row);
    if (href) return { href };
    if (onRowClick) return { onClick: () => onRowClick(row) };
    return {};
  };

  // A pointer click anywhere on a row or card. The keyboard reaches the same
  // navigation through the row's way in (`RowEntry`).
  const activateRow = (nav: RowNavigation) => () => {
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
          <Button {...ROW_ACTIONS_TRIGGER} aria-label="Row actions">
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

  // The columns before the data: the detail toggle's, then the selection's. A
  // row's region spans the rest, so it lines up under the first data column.
  const leadColumns = (rowDetail ? 1 : 0) + (selection ? 1 : 0);
  const colSpan = leadColumns + visibleColumns.length + (hasRowActions ? 1 : 0);

  // Element ids for the toggles' `aria-controls` and the regions' names, built
  // from the row's place in the list rather than its id, which may hold
  // characters an id list cannot. Prefixed per view: both views are mounted.
  const baseId = useId();
  const placed = useMemo<PlacedRow<Row>[]>(
    () => rows.map((row, index) => ({ row, id: getRowId(row), index })),
    [rows, getRowId]
  );
  const sections = useMemo(
    () => sectionRows(placed, grouping),
    [placed, grouping]
  );
  const listIsEmpty = isListEmpty(rows, grouping);

  // One open state and one folded state, read by both views, so a row opened
  // in the cards is open in the table when the width changes.
  const expanded = useToggledIds(
    rowDetail?.expandedIds,
    rowDetail?.defaultExpandedIds,
    rowDetail?.onExpandedChange
  );
  const folded = useToggledIds(
    grouping?.collapsedIds,
    grouping?.defaultCollapsedIds,
    grouping?.onCollapsedChange
  );
  // What either view needs to draw a row, decided once for both: where it
  // leads, whether it can be selected, and whether it has a region, open or
  // closed. `view` prefixes the element ids, since both views are mounted.
  const describeRow = (entry: PlacedRow<Row>, view: "t" | "c") => {
    const { row, id, index } = entry;
    const nav = resolveRow(row);
    const detail =
      rowDetail !== undefined && (rowDetail.hasDetail?.(row) ?? true);
    const elementId = `${baseId}-${view}${index}`;
    return {
      row,
      id,
      nav,
      clickable: Boolean(nav.href || nav.onClick),
      selectable: selection?.isSelectable?.(row) ?? true,
      detail,
      open: detail && expanded.isOn(id),
      elementId,
      nameId: `${elementId}-name`,
      regionId: `${elementId}-detail`,
    };
  };

  // One row of the table, and below it the row's region when it has one. The
  // region's row is in the DOM while closed (hidden), so the toggle's
  // `aria-controls` always names an element; its content is asked for only
  // while open. `hiddenByGroup` hides both while their group is folded.
  const renderTableRow = (entry: PlacedRow<Row>, hiddenByGroup: boolean) => {
    const {
      row,
      id,
      nav,
      clickable,
      selectable,
      detail,
      open,
      elementId,
      nameId,
      regionId,
    } = describeRow(entry, "t");
    return (
      <Fragment key={id}>
        <TableRow
          id={elementId}
          hidden={hiddenByGroup}
          // The same name the card view gives this row.
          data-row-id={id}
          data-state={selectedSet.has(id) ? "selected" : undefined}
          className={cn(
            "hover-unified-table-row",
            clickable && "cursor-pointer",
            selectedSet.has(id) && "bg-muted/50",
            // An open row and its region read as one band.
            open && "border-b-0 bg-muted/30"
          )}
          // No role or tab stop: the primary cell is the row's
          // way in, and the row holds other controls.
          onClick={activateRow(nav)}
        >
          {rowDetail && (
            <TableCell className="w-10 pr-0" onClick={e => e.stopPropagation()}>
              {detail && (
                <DetailToggle
                  open={open}
                  controls={regionId}
                  nameId={nameId}
                  label={rowDetail?.toggleLabel?.(row)}
                  onToggle={() => expanded.toggle(id)}
                />
              )}
            </TableCell>
          )}
          {selection && (
            <TableCell
              className={SELECTION_COLUMN}
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
              // The identifying cell names the row's toggle and region.
              id={col.name === firstColName ? nameId : undefined}
              className={cn(
                col.align === "right" && "text-right",
                col.align === "center" && "text-center"
              )}
            >
              {renderCell(col, row, nav, col.name === firstColName)}
            </TableCell>
          ))}
          {hasRowActions && (
            <TableCell
              className={ROW_ACTIONS_COLUMN}
              onClick={e => e.stopPropagation()}
            >
              {renderRowActions(row)}
            </TableCell>
          )}
        </TableRow>
        {detail && (
          <TableRow
            hidden={hiddenByGroup || !open}
            data-row-detail={id}
            className="bg-muted/30"
          >
            <TableCell colSpan={leadColumns} className="p-0" />
            <TableCell colSpan={colSpan - leadColumns} className="pt-0">
              <div id={regionId} role="region" aria-labelledby={nameId}>
                {open ? rowDetail?.render(row) : null}
              </div>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  // One run of the table's rows: a row group under its header row when it is
  // a group, a plain body otherwise. The header names the group through its
  // title alone, and a folding group's button controls its rows.
  const renderTableSection = (section: RowSection<Row>, position: number) => {
    const { group } = section;
    if (!group) {
      return (
        <TableBody key="rows" className={LAST_SHOWN_ROW_FLAT}>
          {section.rows.map(entry => renderTableRow(entry, false))}
        </TableBody>
      );
    }
    const titleId = `${baseId}-g${position}-t-title`;
    const open = !folded.isOn(group.id);
    const folds = Boolean(grouping?.collapsible) && section.rows.length > 0;
    return (
      <TableBody
        key={`group:${group.id}`}
        aria-labelledby={titleId}
        data-group-id={group.id}
        className={LAST_SHOWN_ROW_FLAT}
      >
        <TableRow data-group-header="" className="border-t bg-muted/30">
          <th
            scope="rowgroup"
            colSpan={colSpan}
            className="px-4 py-2.5 text-left align-middle text-sm font-normal"
          >
            <GroupHeading
              group={group}
              rowCount={section.rows.length}
              titleId={titleId}
              fold={
                folds
                  ? {
                      open,
                      controls: section.rows
                        .map(entry => describeRow(entry, "t").elementId)
                        .join(" "),
                      onToggle: () => folded.toggle(group.id),
                    }
                  : undefined
              }
            />
          </th>
        </TableRow>
        {section.rows.map(entry => renderTableRow(entry, !open))}
      </TableBody>
    );
  };

  // One row as a card. A row with a region gets a toggle in the card, below
  // its fields; a click there stays there rather than opening the card.
  const renderCard = (entry: PlacedRow<Row>) => {
    const {
      row,
      id,
      nav,
      clickable,
      selectable,
      detail,
      open,
      nameId,
      regionId,
    } = describeRow(entry, "c");
    return (
      <Card
        key={id}
        // Names the row, so a page can find the card again by the
        // row's id: to return focus to it, for one.
        data-row-id={id}
        variant={clickable ? "interactive" : "default"}
        className={cn(clickable && "cursor-pointer")}
        // No role or tab stop: the title is the card's way in.
        onClick={activateRow(nav)}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
          {/* min-w-0: without it the title refuses to shrink below
              its content and pushes the header row past the card,
              painting long primary/secondary text over the border. */}
          <CardTitle id={nameId} className="min-w-0 text-base">
            {cardPrimary ? (
              renderCell(cardPrimary, row, nav, true)
            ) : (
              <RowEntry nav={nav}>{id}</RowEntry>
            )}
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
                      // min-w-0 with flex-1: a long value (URLs,
                      // version strings) must be allowed to shrink
                      // so truncate/wrap inside the cell engages.
                      "min-w-0 flex-1",
                      col.hideLabelOnMobile ? "text-left" : "text-right"
                    )}
                  >
                    {renderCell(col, row, nav, false)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        )}
        {detail && (
          <CardContent className="pt-0 pb-3" onClick={e => e.stopPropagation()}>
            <DetailToggle
              visibleText
              open={open}
              controls={regionId}
              nameId={nameId}
              label={rowDetail?.toggleLabel?.(row)}
              onToggle={() => expanded.toggle(id)}
            />
            {/* `hidden` alone loses to a display utility, so the class
                follows the state too. */}
            <div
              id={regionId}
              role="region"
              aria-labelledby={nameId}
              hidden={!open}
              className={open ? "mt-2 text-sm" : "hidden"}
            >
              {open ? rowDetail?.render(row) : null}
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  // One run of cards: a named section under the group's header when it is a
  // group, whose fold button controls the cards' container.
  const renderCardSection = (section: RowSection<Row>, position: number) => {
    const { group } = section;
    if (!group) {
      return <Fragment key="rows">{section.rows.map(renderCard)}</Fragment>;
    }
    const titleId = `${baseId}-g${position}-c-title`;
    const cardsId = `${baseId}-g${position}-c-rows`;
    const open = !folded.isOn(group.id);
    const folds = Boolean(grouping?.collapsible) && section.rows.length > 0;
    return (
      <section
        key={`group:${group.id}`}
        aria-labelledby={titleId}
        data-group-id={group.id}
        className="flex flex-col gap-3"
      >
        <GroupHeading
          group={group}
          rowCount={section.rows.length}
          titleId={titleId}
          fold={
            folds
              ? {
                  open,
                  controls: cardsId,
                  onToggle: () => folded.toggle(group.id),
                }
              : undefined
          }
        />
        <div
          id={cardsId}
          hidden={!open}
          className={open ? "flex flex-col gap-4" : "hidden"}
        >
          {section.rows.map(renderCard)}
        </div>
      </section>
    );
  };

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
  // Both render, footer first, rather than one displacing the other. `footer`
  // takes an arbitrary node and not a pager, so a caller can legitimately hold a
  // selection summary or bulk actions there while paginating -- a summary above
  // its pager is a real arrangement. Letting `pagination` win would drop that
  // content with both props public, both permitted by the type, and nothing
  // reporting the loss. Footer first because a summary describes the rows above
  // it and the pager moves between them.
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
          className="rounded-md border border-danger-border bg-danger-surface p-3 text-sm text-danger-text"
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
          className="mb-3 rounded-md border border-danger-border bg-danger-surface p-3 text-sm text-danger-text"
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
        <div data-view="cards" className="flex flex-col gap-4 @md/table:hidden">
          {loading && rows.length === 0 ? (
            <div className="p-8 text-center">
              <TableLoading />
            </div>
          ) : listIsEmpty ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            sections.map(renderCardSection)
          )}
        </div>

        {/* Desktop / wide: table view. Named as a table's outline names its
            rows, so a test can hold the two to one box. */}
        <div data-frame-part="list-rows" className="hidden @md/table:block">
          <div className="overflow-x-auto">
            <Table
              aria-label={ariaLabel}
              className={cn(
                "w-full min-w-max",
                fixedLayout && FIXED_LAYOUT_TABLE
              )}
            >
              <TableHeader>
                <TableRow>
                  {rowDetail && (
                    <TableHead className="w-10 pr-0">
                      <span className="sr-only">Details</span>
                    </TableHead>
                  )}
                  {selection && (
                    <TableHead className={SELECTION_COLUMN}>
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
                          canSort && "relative cursor-pointer select-none"
                        )}
                        style={fixedLayout ? { width: col.width } : undefined}
                        aria-sort={ariaSortOf(sorted, canSort)}
                      >
                        <HeaderLabel
                          label={col.header}
                          sorted={sorted}
                          align={col.align}
                          onSort={
                            canSort
                              ? () =>
                                  onSortChange?.(
                                    col.name,
                                    sorted === "asc" ? "desc" : "asc"
                                  )
                              : undefined
                          }
                        />
                      </TableHead>
                    );
                  })}
                  {hasRowActions && (
                    <TableHead className={ROW_ACTIONS_COLUMN} />
                  )}
                </TableRow>
              </TableHeader>
              {loading && rows.length === 0 ? (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={colSpan} className="h-24 text-center">
                      <TableLoading />
                    </TableCell>
                  </TableRow>
                </TableBody>
              ) : listIsEmpty ? (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={colSpan} className="h-24 text-center">
                      <TableEmpty message={emptyMessage} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              ) : (
                sections.map(renderTableSection)
              )}
            </Table>
          </div>
        </div>
        {footerContent}
      </div>
    </div>
  );
}
