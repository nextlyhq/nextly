import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/**
 * The frame every admin list sits in: an optional toolbar, the table, and its
 * pagination.
 *
 * This exists because the frame was the duplicated part, not the table. Every
 * list surface already renders through `DataTableView`, and there is one
 * `Pagination` and one `SearchBar` -- but each page hand-rolled the card around
 * them, and they disagreed. Two shells shipped at once: one holding pagination
 * INSIDE the bordered card, and one leaving it outside as a sibling under
 * `space-y-4`. The second gives a row of dead space and a pagination bar
 * carrying a top border and no other sides, reading as an orphaned strip rather
 * than the table's footer.
 *
 * Placing pagination inside the card is what makes it a footer: it supplies its
 * own `border-t`, so the card's own border is the only outline and the divider
 * comes for free. Bordering the two separately doubles the outline AND opens
 * the gap.
 *
 * Presentational on purpose. It takes rendered nodes rather than data, columns
 * or fetchers, because each page already owns its own fetching and a shell that
 * demanded otherwise would go unused -- which is exactly what happened to the
 * batteries-included `DataTable`, which no admin route renders.
 *
 * Pass the table with `bordered={false}`: the shell draws the border, and a
 * bordered view inside a bordered shell is the doubling described above.
 */
export interface ListShellProps {
  /** Search, filters and column controls. Rendered above the card. */
  toolbar?: ReactNode;
  /** The table itself, normally a `DataTableView` with `bordered={false}`. */
  children: ReactNode;
  /**
   * Rendered inside the card, directly below the table, so its own `border-t`
   * reads as the divider. Omit it when a list does not paginate.
   */
  pagination?: ReactNode;
  className?: string;
}

export function ListShell({
  toolbar,
  children,
  pagination,
  className,
}: ListShellProps) {
  return (
    <div className={cn("@container/list w-full space-y-4", className)}>
      {toolbar}
      {/* The card treatment is desktop-only, and the breakpoint is a container
          query rather than a viewport one so it turns on with the same box
          `DataTableView` measures. Below it, that component hides the table and
          renders every row as its own bordered Card; an enclosing card there
          would wrap a stack of cards in a second card and clip their corners
          against its `overflow-hidden`. */}
      <div className="@md/list:overflow-hidden @md/list:rounded-md @md/list:border @md/list:border-border @md/list:bg-card @md/list:text-card-foreground">
        {children}
        {/* Pagination is a footer only where there is a card to be the footer
            OF. Below the breakpoint the rows are separate cards and there is no
            enclosing edge, so its own `border-t` would land against the last
            card's rounded corner and read as a hairline stuck to it. There it
            gets the gap the surrounding rhythm uses instead, and the divider
            does the work only once the card exists. */}
        {pagination && <div className="mt-4 @md/list:mt-0">{pagination}</div>}
      </div>
    </div>
  );
}
