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
        // `bg-card` rather than `bg-background`: this stands where the table's
        // card stands, so it has to read as the same surface. A page whose list
        // is empty should not look like a page with a hole in it.
        "flex flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-14 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      {/*
       * A real heading, not a styled paragraph. This is the only thing on the
       * screen when a list is empty, so it is the page's content for that
       * reader — and a paragraph gives assistive technology nothing to land on.
       * `h3` because the page and section headings above it are h1/h2.
       */}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
