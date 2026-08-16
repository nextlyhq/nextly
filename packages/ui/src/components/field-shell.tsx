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

/**
 * Reads the `id` a child element already carries, if any.
 *
 * Radix `Slot`'s own prop merge lets a key present on the child's props win
 * over whatever `id` Slot receives — unconditionally, regardless of what this
 * component asked it to inject (see `mergeProps` in `@radix-ui/react-slot`).
 * So the id this function reports is the one that will actually land in the
 * DOM, and it is what the label has to target rather than the id FieldShell
 * merely offered. `children.props` is untyped (`ReactElement<unknown>`), so
 * this narrows it defensively instead of asserting a shape onto it.
 */
function readOwnId(child: FieldShellProps["children"]): string | undefined {
  const props: unknown = child.props;
  if (props && typeof props === "object" && "id" in props) {
    const value = (props as { id?: unknown }).id;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

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
  // Two independent id namespaces: one for the control (below), one for the
  // description/error text this field may render. The latter never depends
  // on `htmlFor` or the child's own id, because those name the CONTROL, not
  // FieldShell's own paragraphs.
  const generatedControlId = useId();
  const messageBaseId = useId();
  const descriptionId = `${messageBaseId}-description`;
  const errorId = `${messageBaseId}-error`;

  // What FieldShell asks Slot to inject, honoring `htmlFor` when the caller
  // supplied one and falling back to a generated id otherwise.
  const requestedId = htmlFor ?? generatedControlId;
  // What actually ends up on the control: the child's own id wins over the
  // requested one whenever the child sets one at all (see `readOwnId`), so
  // the label has to target THAT id rather than `requestedId` to stay
  // accurate for a caller-supplied child that already carries an id.
  const controlId = readOwnId(children) ?? requestedId;

  // Only messages that actually render get an id, and only those ids are
  // listed: a control pointed at an id nothing carries is worse than one
  // with no description at all.
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter((id): id is string => id !== null)
      .join(" ") || undefined;

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
        {/* Slot injects the id, description and validation state onto the
            child rather than wrapping it in an extra DOM node. A child that
            already sets its own `id` keeps it: Slot's prop merge gives the
            child's own props precedence over the ones passed here. */}
        <Slot
          id={requestedId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        >
          {children}
        </Slot>
      </div>
      {description ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
