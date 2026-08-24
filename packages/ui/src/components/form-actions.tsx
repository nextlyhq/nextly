import { cn } from "../lib/utils";
import type { FormActionsProps } from "../types/form-layout";

/**
 * One action bar per form, at the end of the page's measure.
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
