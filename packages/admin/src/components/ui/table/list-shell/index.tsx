import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/**
 * Vertical rhythm for an admin list: a toolbar above the table.
 *
 * Deliberately thin. An earlier version also drew the card and placed the
 * pagination inside it, which put the responsive decision in two places: this
 * wrapper asked one container query whether to draw a card, and `DataTableView`
 * asked a different one whether to render a table or per-row cards. Those two
 * boxes are not the same width -- the inner one is narrower by the card's own
 * border -- so across a two-pixel band the wrapper drew a card while the table
 * was still rendering row cards, nesting them inside it.
 *
 * The fix was not a better query but one owner. `DataTableView` already knows
 * which view it is in and already draws the desktop card, so it also takes the
 * `footer`: inside the card where there is a card, and below the rows with a
 * gap where there is not. Nothing here needs to know the breakpoint, which is
 * why nothing here asks.
 */
export interface ListShellProps {
  /** Search, filters and column controls. Rendered above the table. */
  toolbar?: ReactNode;
  /** The table, normally a `DataTableView` carrying its own `footer`. */
  children: ReactNode;
  className?: string;
}

export function ListShell({ toolbar, children, className }: ListShellProps) {
  return (
    <div className={cn("w-full space-y-4", className)}>
      {toolbar}
      {children}
    </div>
  );
}
