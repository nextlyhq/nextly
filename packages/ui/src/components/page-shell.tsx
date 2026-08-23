import type * as React from "react";

import { cn } from "../lib/utils";

/** @experimental */
export interface PageShellProps {
  /**
   * Which measure the content column is bounded to. `full` removes the cap so
   * the column takes whatever the panel gives it, while KEEPING the gutter — a
   * full-width page is still inset from the panel's edge.
   */
  width?: "form" | "wide" | "full";
  className?: string;
  children: React.ReactNode;
}

/**
 * Declared as a lookup rather than branched at the call site so the three arms
 * are one list. A `switch` here would let a fourth width be added to the type
 * and forgotten in the mapping, which the checker cannot see through a
 * `default` arm.
 */
const MEASURE: Record<NonNullable<PageShellProps["width"]>, string> = {
  form: "var(--nx-measure-form)",
  wide: "var(--nx-measure-wide)",
  full: "100%",
};

/**
 * The page's inset and measure, owned in one place and spent as GRID COLUMNS.
 *
 * This replaces a pairing in which an outer container padded the panel and an
 * inner one padded again while capping the width. That shape had three
 * defects, and all three are structural rather than cosmetic:
 *
 *  - The two insets ADDED, because padding is not something a descendant can
 *    cancel. Measured on the settings page, the header sat at x=360 and the
 *    form card at x=384 — a 24px disagreement between two elements that are
 *    supposed to share a left edge. Here the inset is a column, so there is one
 *    declaration and no second site to disagree with it.
 *  - The measure was applied INSIDE each form component, so anything the page
 *    rendered beside that form escaped it. Not hypothetical: the webhook edit
 *    page renders its signing-secret block as a sibling of the form, and it ran
 *    the full panel width while the form was centred. With the page owning the
 *    shell, a sibling is inside the measure by default and leaves it only by
 *    saying `Bleed`.
 *  - Centring was `mx-auto` on a max-width box, which does nothing at panel
 *    widths where the cap does not bind — and at the measured 952px panel the
 *    56rem cap never binds at all, so the apparent centring was only the two
 *    paddings. `justify-content: center` on the grid centres the column at
 *    every width.
 *
 * Vertical padding stays ordinary `padding-block`: it is not in tension with
 * the columns, and keeping it here means one component answers the whole of
 * "how far is content from the panel's edge".
 * @experimental
 */
export function PageShell({
  width = "form",
  className,
  children,
}: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      // The measure travels as a custom property rather than as a utility
      // class, because the grid template reads it: one `grid-template-columns`
      // serves all three widths, instead of three near-identical templates
      // that would each have to be corrected together.
      style={{ "--nx-shell-measure": MEASURE[width] } as React.CSSProperties}
      className={cn("nx-page-shell py-8", className)}
    >
      {children}
    </div>
  );
}

/** @experimental */
export interface BleedProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Opts one child out of the measure, edge to edge across the shell's gutter.
 *
 * The sanctioned form of something that previously only happened by accident.
 * A wide data table, a delivery log or a toolbar declares that it wants the
 * full panel, so a reviewer can see the intent — and, just as usefully, a block
 * that is merely in the wrong place no longer LOOKS like a deliberate
 * full-bleed.
 *
 * Valid only as a DIRECT child of `PageShell`. The `full-start`/`full-end`
 * lines are named on the shell's own grid, so they are in scope for its
 * children and nowhere else; nested inside a `FormSection` this renders a plain
 * block and the `grid-column` is inert. That is a real constraint rather than a
 * stylistic preference, and `page-shell.test.tsx` pins the parent relationship
 * so a future wrapper cannot quietly break every full-bleed block on a page.
 * @experimental
 */
export function Bleed({ className, children }: BleedProps) {
  return (
    <div data-slot="bleed" className={cn("nx-bleed", className)}>
      {children}
    </div>
  );
}
