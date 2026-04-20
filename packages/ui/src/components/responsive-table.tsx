import * as React from "react";

import { cn } from "../lib/utils";
import type { Column, ResponsiveTableProps } from "../types/responsive-table";

import { Card, CardContent, CardHeader, CardTitle } from "./card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

// Re-export types for convenience
export type { Column, ResponsiveTableProps };

/**
 * ResponsiveTable Component
 *
 * A responsive table component that displays as cards on mobile (< 768px)
 * and as a traditional table on desktop (≥ 768px).
 *
 * ## Design Specifications
 * - **Breakpoint**: 768px (md) - cards below, table above
 * - **Mobile**: Card view with CardHeader (first column) and CardContent (remaining columns)
 * - **Desktop**: Traditional table with all columns
 * - **Spacing**: 16px gap between cards (space-y-4)
 * - **Typography**: text-base for card titles, text-sm for labels/values
 * - **Border Radius**: 0px for cards (rounded-none), 0px for table (rounded-none)
 *
 * ## Accessibility
 * - Interactive cards/rows have proper cursor-pointer and hover states
 * - Keyboard navigation supported via onClick handler
 * - WCAG 2.2 AA compliant color contrast
 * - Touch targets meet 44×44px minimum on mobile
 * - Screen reader support via semantic HTML
 *
 * ## Performance Considerations
 * - **Recommended Dataset Size**: 50-100 rows maximum
 * - **Large Datasets (100+ rows)**: Consider implementing:
 *   - Pagination to limit rows per page (recommended)
 *   - Virtual scrolling (e.g., @tanstack/react-virtual) for table view
 *   - Server-side filtering and sorting
 * - Component uses `useMemo` for column filtering optimization
 * - Mobile card rendering can be performance-intensive with many rows
 *
 * ## Usage Examples
 *
 * ### Basic Usage
 * ```tsx
 * const columns: Column<User>[] = [
 *   { key: "name", label: "Name" },
 *   { key: "email", label: "Email" },
 *   { key: "role", label: "Role" },
 * ];
 *
 * <ResponsiveTable
 *   data={users}
 *   columns={columns}
 *   onRowClick={(user) => console.log(user)}
 * />
 * ```
 *
 * ### With Custom Cell Renderers
 * ```tsx
 * const columns: Column<User>[] = [
 *   {
 *     key: "name",
 *     label: "Name",
 *     render: (value, user) => (
 *       <div className="flex items-center gap-3">
 *         <Avatar size="md">
 *           <AvatarImage src={user.image} alt={user.name} />
 *           <AvatarFallback>{user.name[0]}</AvatarFallback>
 *         </Avatar>
 *         <div>
 *           <div className="font-medium">{user.name}</div>
 *           <div className="text-sm text-muted-foreground">{user.email}</div>
 *         </div>
 *       </div>
 *     ),
 *   },
 *   {
 *     key: "status",
 *     label: "Status",
 *     render: (value) => (
 *       <Badge variant={value === "active" ? "success" : "default"}>
 *         {value}
 *       </Badge>
 *     ),
 *   },
 * ];
 * ```
 *
 * ### With TanStack Table Integration (Future)
 * ```tsx
 * // Can be extended to work with TanStack Table ColumnDef
 * // by mapping ColumnDef to Column interface
 * const columns = userColumns.map(col => ({
 *   key: col.accessorKey,
 *   label: col.header,
 *   render: col.cell,
 * }));
 * ```
 *
 * @template T - The data type of items in the table
 */
function ResponsiveTableInner<T extends { id: string }>(
  {
    data,
    columns,
    onRowClick,
    renderMobileCard,
    className,
    emptyMessage = "No results found.",
    ariaLabel,
    tableWrapperClassName,
    footer,
  }: ResponsiveTableProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const visibleMobileColumns = React.useMemo(
    () => columns.filter(col => !col.hideOnMobile),
    [columns]
  );

  // Find the best column to use as the primary title on mobile
  // Skip technical/action columns like 'select' or 'actions'
  const primaryColumn = React.useMemo(() => {
    return (
      visibleMobileColumns.find(
        col => col.key !== "select" && col.key !== "actions"
      ) || visibleMobileColumns[0]
    );
  }, [visibleMobileColumns]);

  const secondaryColumns = React.useMemo(
    () => visibleMobileColumns.filter(col => col.key !== primaryColumn?.key),
    [visibleMobileColumns, primaryColumn]
  );

  // Development mode warning for UX issue
  React.useEffect(() => {
    const isDev =
      typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).process &&
      (
        (globalThis as Record<string, unknown>).process as {
          env?: { NODE_ENV?: string };
        }
      ).env?.NODE_ENV === "development";
    if (isDev && visibleMobileColumns.length === 0) {
      console.warn(
        "ResponsiveTable: All columns are hidden on mobile (hideOnMobile: true). " +
          "Consider showing at least one column for better mobile UX. " +
          "Users will see empty card borders on mobile devices."
      );
    }
  }, [visibleMobileColumns.length]);

  // Helper for row clicks to ignore interactive elements
  const handleItemClick = React.useCallback(
    (item: T, e?: React.MouseEvent | React.KeyboardEvent) => {
      if (!onRowClick) return;
      if (e) {
        const target = e.target as HTMLElement;
        if (
          target.closest('[role="checkbox"]') ||
          target.closest("button") ||
          target.closest("a") ||
          target.closest('[role^="menuitem"]') ||
          target.closest("[data-actions]")
        ) {
          return; // Ignore clicks on interactive elements
        }
      }
      onRowClick(item);
    },
    [onRowClick]
  );

  // Keyboard event handler for interactive cards
  const handleCardKeyDown = React.useCallback(
    (item: T) => (e: React.KeyboardEvent) => {
      if (onRowClick && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        handleItemClick(item, e);
      }
    },
    [handleItemClick, onRowClick]
  );

  // Empty state
  if (data.length === 0) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-none border border-border p-8 text-center",
          className
        )}
      >
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("w-full", className)}>
      {/* Mobile: Card view */}
      <div className="flex flex-col gap-4 md:hidden">
        {data.map(item => {
          // Calculate primary value for aria-label (used in both custom and default rendering)
          const primaryValue = primaryColumn
            ? String(item[primaryColumn.key])
            : String(item.id);

          // Use custom renderer if provided
          if (renderMobileCard) {
            return (
              <div
                key={item.id}
                onClick={e => handleItemClick(item, e)}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? handleCardKeyDown(item) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
                aria-label={
                  onRowClick ? `View details for ${primaryValue}` : undefined
                }
              >
                {renderMobileCard(item, visibleMobileColumns)}
              </div>
            );
          }

          // Default card rendering

          return (
            <Card
              key={item.id}
              variant={onRowClick ? "interactive" : "default"}
              className={cn(
                onRowClick && "cursor-pointer",
                "transition-all duration-150"
              )}
              onClick={e => handleItemClick(item, e)}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? handleCardKeyDown(item) : undefined}
              aria-label={
                onRowClick ? `View details for ${primaryValue}` : undefined
              }
            >
              {/* Card Header: Primary column (first column) */}
              {primaryColumn ? (
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {primaryColumn.render
                      ? primaryColumn.render(item[primaryColumn.key], item)
                      : String(item[primaryColumn.key])}
                  </CardTitle>
                </CardHeader>
              ) : null}

              {/* Card Content: Secondary columns (remaining columns) */}
              {secondaryColumns.length > 0 && (
                <CardContent className="pb-3">
                  <dl className="flex flex-col gap-2">
                    {secondaryColumns.map(column => (
                      <div
                        key={String(column.key)} // String() ensures unique key even for symbol/number keys
                        className="flex items-start justify-between gap-4 text-sm"
                      >
                        {!column.hideLabelOnMobile && (
                          <dt className="text-muted-foreground min-w-[80px] shrink-0">
                            {column.label}:
                          </dt>
                        )}
                        <dd
                          className={cn(
                            "font-medium flex-1",
                            !column.hideLabelOnMobile
                              ? "text-right"
                              : "text-left"
                          )}
                        >
                          {column.render
                            ? column.render(item[column.key], item)
                            : String(item[column.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Desktop: Table view */}
      <div
        className={cn(
          "table-wrapper hidden md:block overflow-hidden rounded-none border border-border",
          tableWrapperClassName
        )}
      >
        <Table aria-label={ariaLabel || "Data table"}>
          <TableHeader>
            <TableRow>
              {columns.map(column => (
                <TableHead key={String(column.key)}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(item => {
              const primaryValue = primaryColumn
                ? String(item[primaryColumn.key])
                : String(item.id);

              return (
                <TableRow
                  key={item.id}
                  className={cn(
                    "hover-unified-table-row",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={e => handleItemClick(item, e)}
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? handleCardKeyDown(item) : undefined}
                  aria-label={
                    onRowClick ? `View details for ${primaryValue}` : undefined
                  }
                >
                  {columns.map(column => (
                    <TableCell
                      key={String(
                        column.key
                      )} /* String() for consistent key type */
                    >
                      {column.render
                        ? column.render(item[column.key], item)
                        : String(item[column.key])}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {footer && <div className="table-footer">{footer}</div>}
    </div>
  );
}

export const ResponsiveTable = React.forwardRef(ResponsiveTableInner) as <
  T extends { id: string },
>(
  props: ResponsiveTableProps<T> & {
    ref?: React.ForwardedRef<HTMLDivElement>;
  }
) => React.ReactElement;
