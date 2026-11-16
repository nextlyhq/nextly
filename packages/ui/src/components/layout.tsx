/**
 * Layout primitives for admin UI (plugins included).
 *
 * Token/utility-driven wrappers so a plugin can build common layouts —
 * vertical/horizontal stacks, responsive grids, labelled stat blocks — from the
 * admin's compiled stylesheet with no plugin build step. Gap/column values are
 * mapped to literal class names (not template strings) so Tailwind's scanner
 * detects and emits them.
 */
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type RefAttributes,
} from "react";

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
export const Stack: ForwardRefExoticComponent<
  PropsWithoutRef<StackProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, StackProps>(
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
export const Grid: ForwardRefExoticComponent<
  PropsWithoutRef<GridProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, GridProps>(
  (
    { cols = 2, gap = 4, responsive = false, className, children, ...rest },
    ref
  ) => {
    if (!responsive) {
      // No wrapper: the single element IS the grid, exactly as before
      // `responsive` existed, so an existing caller's className, style and
      // other HTML attributes keep landing on the one node it renders.
      return (
        <div
          ref={ref}
          className={cn("grid", COLS[cols], GAP[gap], className)}
          {...rest}
        >
          {children}
        </div>
      );
    }

    // Responsive mode renders its own unnamed `@container` wrapper so the
    // grid queries the space IT has, not any ancestor's — no dependency on a
    // named container declared elsewhere in the tree.
    //
    // That wrapper is the element that actually participates in the PARENT's
    // layout, so everything describing how this Grid sits in its parent —
    // `className`, `style` and the rest of the HTML attributes, plus `ref` —
    // belongs on it rather than on the inner grid. `cols` and `gap` describe
    // the grid's OWN internal layout and stay on the inner element regardless
    // of which mode is active. A caller passing spacing through `className`
    // instead of `gap` is already misusing the prop, not losing information.
    return (
      <div ref={ref} className={cn("@container", className)} {...rest}>
        <div className={cn("grid", RESPONSIVE_COLS[cols], GAP[gap])}>
          {children}
        </div>
      </div>
    );
  }
);
Grid.displayName = "Grid";

/** A stat's tone: the status a dot before its value marks, as a badge's does. */
type StatTone = "success" | "warning" | "destructive" | "info";

/** Each tone's dot, in the status's solid colour (the same as `Badge`'s). */
const STAT_TONE_DOT: Record<StatTone, string> = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  destructive: "bg-danger-solid",
  info: "bg-info-solid",
};

/** @experimental */
export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  /** Muted label above the value. */
  label: string;
  /** The emphasized value (string or node). */
  value: ReactNode;
  /**
   * A dot before the value in a status's colour, such as `warning` beside
   * "Should improve". It only marks the value: the value's own words say
   * what it means, so colour is never the only sign. No dot when unset.
   */
  tone?: StatTone;
  /**
   * `compact` draws the value smaller (20px rather than 24px), for a figure
   * that leads a small card, with its label as the card's semibold title.
   * Default `default`.
   */
  size?: "default" | "compact";
}

/** Labelled metric block for dashboard-style plugin widgets.
 * @experimental
 */
export const Stat: ForwardRefExoticComponent<
  PropsWithoutRef<StatProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, StatProps>(
  ({ label, value, tone, size = "default", className, ...props }, ref) => {
    const compact = size === "compact";
    const figure = (
      <span
        className={cn(
          "font-semibold text-foreground",
          compact ? "text-xl" : "text-2xl"
        )}
      >
        {value}
      </span>
    );
    return (
      <div
        ref={ref}
        className={cn("flex flex-col", compact ? "gap-3" : "gap-1", className)}
        {...props}
      >
        <span
          className={cn(
            "text-sm text-muted-foreground",
            compact && "font-semibold"
          )}
        >
          {label}
        </span>
        {/* Without a tone the value is drawn as it always was, unwrapped. */}
        {tone === undefined ? (
          figure
        ) : (
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              data-stat-tone={tone}
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                STAT_TONE_DOT[tone]
              )}
            />
            {figure}
          </span>
        )}
      </div>
    );
  }
);
Stat.displayName = "Stat";
