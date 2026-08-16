import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { useId } from "react";

import { cn } from "../lib/utils";
import type { FieldShellProps } from "../types/form-layout";

/**
 * The width cap applies to a wrapper around the control, not to the field row.
 *
 * The row keeps its container's full width so labels, descriptions and errors
 * align down the form; only the control itself is bounded. Capping the row
 * would indent the label along with the input and make a column of mixed-width
 * fields read as ragged.
 *
 * The fallbacks are the literals a caller would otherwise reach for, so the
 * component works before any theme defines these properties.
 */
const controlWidth = cva("w-full", {
  variants: {
    width: {
      half: "max-w-[var(--nx-field-half,380px)]",
      full: "max-w-[var(--nx-field-full,760px)]",
      fill: "",
    },
  },
  defaultVariants: { width: "half" },
});

/** @experimental */
export function FieldShell({
  label,
  description,
  error,
  width = "half",
  htmlFor,
  className,
  children,
}: FieldShellProps) {
  // `htmlFor` stays supported for callers that manage their own ids; when it
  // is omitted, generate one so the simplest usage (a label with no explicit
  // id anywhere) still produces a working label/control association instead
  // of a label that merely sits next to its control.
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label
          htmlFor={controlId}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
      ) : null}
      <div className={controlWidth({ width })}>
        {/* Slot injects the id onto the child rather than wrapping it in an
            extra DOM node. A child that already sets its own `id` keeps it:
            Slot's prop merge gives the child's own props precedence over the
            ones passed to Slot. */}
        <Slot id={controlId}>{children}</Slot>
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
