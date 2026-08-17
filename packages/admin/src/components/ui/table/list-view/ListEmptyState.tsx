"use client";

/**
 * The list's empty state.
 *
 * `DataTableView` takes `emptyMessage` as a bare string, so every surface that
 * wanted an icon, an explanation or a call to action wrote its own component.
 * This is that component, once.
 *
 * @module components/ui/table/list-view/ListEmptyState
 */

import { cn } from "@admin/lib/utils";

import type { ListEmpty } from "./types";

export function ListEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: ListEmpty & { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-border bg-background px-6 py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
