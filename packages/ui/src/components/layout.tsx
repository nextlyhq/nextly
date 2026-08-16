/**
 * Layout primitives for admin UI (plugins included).
 *
 * Token/utility-driven wrappers so a plugin can build common layouts —
 * vertical/horizontal stacks, responsive grids, labelled stat blocks — from the
 * admin's compiled stylesheet with no plugin build step. Gap/column values are
 * mapped to literal class names (not template strings) so Tailwind's scanner
 * detects and emits them.
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../lib/utils";

type Gap = 0 | 1 | 2 | 3 | 4 | 6 | 8;
type Cols = 1 | 2 | 3 | 4 | 6;

const GAP: Record<Gap, string> = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  6: "gap-6",
  8: "gap-8",
};

const COLS: Record<Cols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  6: "grid-cols-6",
};

/**
 * Container-query column counts, used when `responsive` is set.
 *
 * The grid starts at one column and widens at ITS OWN container's breakpoint
 * rather than the viewport's or an ancestor's. Unnamed `@` variants resolve
 * against the nearest container ancestor, which `responsive` mode guarantees
 * by rendering its own `@container` wrapper below — so this works wherever the
 * grid is mounted, with no dependency on a named container declared elsewhere.
 * Literal class names, not template strings, so Tailwind's scanner emits them.
 */
const RESPONSIVE_COLS: Record<Cols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @2xl:grid-cols-2",
  3: "grid-cols-1 @2xl:grid-cols-3",
  4: "grid-cols-1 @2xl:grid-cols-4",
  6: "grid-cols-1 @2xl:grid-cols-6",
};

/** @experimental */
export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Main-axis direction. Default `col`. */
  direction?: "col" | "row";
  /** Gap between children (Tailwind spacing step). Default `4`. */
  gap?: Gap;
}

/** Flex stack: vertical by default, horizontal with `direction="row"`.
 * @experimental
 */
export const Stack = forwardRef<HTMLDivElement, StackProps>(
  ({ direction = "col", gap = 4, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex",
        direction === "col" ? "flex-col" : "flex-row",
        GAP[gap],
        className
      )}
      {...props}
    />
  )
);
Stack.displayName = "Stack";

/** @experimental */
export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Column count. Default `2`. */
  cols?: Cols;
  /** Gap between cells. Default `4`. */
  gap?: Gap;
  /**
   * Collapse to one column in a narrow container. Off by default so existing
   * callers keep the fixed column count they were written against.
   */
  responsive?: boolean;
}

/** Simple fixed-column grid, or a container-responsive one via `responsive`.
 * @experimental
 */
export const Grid = forwardRef<HTMLDivElement, GridProps>(
  ({ cols = 2, gap = 4, responsive = false, className, ...props }, ref) => {
    const grid = (
      <div
        ref={ref}
        className={cn(
          "grid",
          responsive ? RESPONSIVE_COLS[cols] : COLS[cols],
          GAP[gap],
          className
        )}
        {...props}
      />
    );

    // Responsive mode renders its own unnamed `@container` wrapper so the
    // grid queries the space IT has, not any ancestor's — no dependency on a
    // named container declared elsewhere in the tree. Non-responsive mode
    // renders no wrapper at all: existing callers must not gain a DOM node.
    return responsive ? <div className="@container">{grid}</div> : grid;
  }
);
Grid.displayName = "Grid";

/** @experimental */
export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  /** Muted label above the value. */
  label: string;
  /** The emphasized value (string or node). */
  value: ReactNode;
}

/** Labelled metric block for dashboard-style plugin widgets.
 * @experimental
 */
export const Stat = forwardRef<HTMLDivElement, StatProps>(
  ({ label, value, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground">{value}</span>
    </div>
  )
);
Stat.displayName = "Stat";
