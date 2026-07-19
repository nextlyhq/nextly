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

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Main-axis direction. Default `col`. */
  direction?: "col" | "row";
  /** Gap between children (Tailwind spacing step). Default `4`. */
  gap?: Gap;
}

/** Flex stack: vertical by default, horizontal with `direction="row"`. */
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

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Column count. Default `2`. */
  cols?: Cols;
  /** Gap between cells. Default `4`. */
  gap?: Gap;
}

/** Simple fixed-column grid. */
export const Grid = forwardRef<HTMLDivElement, GridProps>(
  ({ cols = 2, gap = 4, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("grid", COLS[cols], GAP[gap], className)}
      {...props}
    />
  )
);
Grid.displayName = "Grid";

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  /** Muted label above the value. */
  label: string;
  /** The emphasized value (string or node). */
  value: ReactNode;
}

/** Labelled metric block for dashboard-style plugin widgets. */
export const Stat = forwardRef<HTMLDivElement, StatProps>(
  ({ label, value, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground">{value}</span>
    </div>
  )
);
Stat.displayName = "Stat";
