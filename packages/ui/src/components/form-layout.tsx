import { cva } from "class-variance-authority";

import { cn } from "../lib/utils";
import type { FormActionsProps, FormLayoutProps } from "../types/form-layout";

/**
 * The measure is owned here rather than by each page.
 *
 * The admin content region is roughly 950px on a laptop once both sidebars are
 * accounted for, so an unbounded form stretches a short text input across the
 * whole of it. Bounding it centrally is also what keeps the column still as the
 * sub-sidebar opens and closes.
 */
const measure = cva("mx-auto w-full px-6 py-8", {
  variants: {
    width: {
      form: "max-w-[56rem]",
      wide: "max-w-[72rem]",
    },
  },
  defaultVariants: { width: "form" },
});

/**
 * @experimental
 */
export function FormLayout({
  width = "form",
  className,
  children,
}: FormLayoutProps) {
  return <div className={cn(measure({ width }), className)}>{children}</div>;
}

/**
 * One action bar per form, at the end of the measure.
 *
 * A form commits as a single document, so there is one place to commit it. The
 * dirty flag arrives from the page because the form state already answers that
 * question, and a second implementation of it here would disagree with the
 * first as soon as either changed.
 * @experimental
 */
export function FormActions({ dirty, className, children }: FormActionsProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 mt-8 flex items-center justify-end gap-3",
        "border-t border-border bg-background/95 py-4 backdrop-blur",
        className
      )}
    >
      {dirty ? (
        // `role="status"` (implying `aria-live="polite"`) so a screen-reader
        // user is told when the flag flips false to true, not only sighted
        // users watching the bar. This is the only live region FormActions
        // renders, one per form.
        <span role="status" className="mr-auto text-sm text-muted-foreground">
          You have unsaved changes
        </span>
      ) : null}
      {children}
    </div>
  );
}
