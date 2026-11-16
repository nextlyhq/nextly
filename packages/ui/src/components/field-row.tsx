import type { HTMLAttributes, JSX, ReactNode } from "react";

import { cn } from "../lib/utils";

/** @experimental */
export interface FieldRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * The left column: the row's label and any help under it, already rendered.
   * A node rather than a string because who names the control differs by
   * caller — a `<label for>` for one control, a `<span>` a group points
   * `aria-labelledby` at for several — and that choice is the caller's.
   */
  aside: ReactNode;
  /** The right column: the control, or the group of controls. */
  children: ReactNode;
}

/**
 * The two-column settings row: label and help on the left, the control on the
 * right, stacking into one column on a narrow screen.
 *
 * Geometry only. It owns the grid and nothing about naming, so the rows that
 * differ in how they label their control — `FieldShell`'s row layout, and the
 * admin's form-bound and grouped settings rows — all draw this one grid rather
 * than three copies of it that could drift apart.
 *
 * It applies no vertical padding: `FormSection` sets the rhythm between its
 * rows, and a row that padded itself as well would double it.
 * @experimental
 */
export function FieldRow({
  aside,
  children,
  className,
  ...props
}: FieldRowProps): JSX.Element {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 items-start",
        className
      )}
      {...props}
    >
      <div className="flex flex-col">{aside}</div>
      <div className="w-full">{children}</div>
    </div>
  );
}
