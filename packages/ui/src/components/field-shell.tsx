import { cva } from "class-variance-authority";
import { cloneElement, Fragment, useId } from "react";

import { devWarnOnce } from "../lib/dev-warn";
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
 * The subset of a child's own props this component reads before deciding
 * what to merge onto it.
 *
 * `child.props` is untyped (`ReactElement<unknown>`), so this narrows it
 * defensively — checking each key is actually present with the expected
 * primitive type — rather than asserting a shape onto a value nothing has
 * verified. A key present with the wrong type (an `id` that is a number, an
 * `aria-describedby` that is a boolean) is treated the same as absent: the
 * caller's field-shell contract is about ids and id-reference strings, and a
 * value that cannot serve as one is not a real override.
 */
interface KnownControlProps {
  id?: unknown;
  "aria-describedby"?: unknown;
}

function readControlProps(
  child: FieldShellProps["children"]
): KnownControlProps {
  const props: unknown = child.props;
  // An object with no properties the type checker knows about is already
  // assignable to a type whose properties are all optional, so no cast is
  // needed here: only the `typeof` guard is doing real work.
  return props && typeof props === "object" ? props : {};
}

/**
 * The props this component injects onto the control, computed once and
 * applied with a single `cloneElement` call.
 *
 * Declared as its own type, rather than inlined at the call site, so the
 * object passed to `cloneElement` carries real key names instead of a
 * loosely-typed record. `children`'s props are unknown to this component (see
 * `KnownControlProps` above), so `cloneElement`'s `Partial<P>` parameter
 * collapses to `{}` for any child it is handed — meaning this type is the
 * only thing constraining what gets attached, and getting its keys right is
 * what keeps a typo from silently landing on the DOM as a data attribute.
 */
interface ControlOverrides {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
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

  // What FieldShell would use for the control absent any id the child
  // already carries: `htmlFor` when the caller supplied one, a generated id
  // otherwise.
  const requestedId = htmlFor ?? generatedControlId;

  const ownProps = readControlProps(children);

  // A non-empty string the child already carries wins over the requested id;
  // anything else — including an explicitly-present `id={undefined}`, which
  // a naive object spread would let win — does not. Deciding this here,
  // rather than leaving it to a generic prop-merge, is the entire point of
  // owning the merge: there is exactly one rule for what counts as "the
  // child already has an id", and it is applied before the clone rather than
  // discovered afterward in whatever a merge library happened to do.
  const ownId =
    typeof ownProps.id === "string" && ownProps.id !== ""
      ? ownProps.id
      : undefined;
  const controlId = ownId ?? requestedId;

  // Only messages that actually render get an id, and only those ids are
  // listed: a control pointed at an id nothing carries is worse than one
  // with no description at all.
  const renderedMessageIds = [
    description ? descriptionId : null,
    error ? errorId : null,
  ].filter((id): id is string => id !== null);

  const ownDescribedByIds =
    typeof ownProps["aria-describedby"] === "string"
      ? ownProps["aria-describedby"].split(" ").filter(Boolean)
      : [];

  // Compose, never replace: a child may already point at ids of its own (a
  // unit label, a character counter) that this component knows nothing
  // about, and overwriting them would break whatever wired them up. The
  // child's own ids come first so the reading order matches what the caller
  // wrote; `Set` then drops any id both sides already agree on.
  const describedByIds = Array.from(
    new Set([...ownDescribedByIds, ...renderedMessageIds])
  );
  const describedBy =
    describedByIds.length > 0 ? describedByIds.join(" ") : undefined;

  const controlOverrides: ControlOverrides = {
    id: controlId,
    ...(describedBy !== undefined ? { "aria-describedby": describedBy } : {}),
    // A rendered error always forces the control invalid: a child that
    // already set `aria-invalid={false}`, or left it unset, must not
    // suppress a validation message that is visibly on the page. With no
    // error the key is omitted entirely rather than set to `undefined`, so
    // `cloneElement` leaves whatever the child already had untouched instead
    // of overwriting it with an absence.
    ...(error ? { "aria-invalid": true } : {}),
  };

  // A Fragment is a valid `ReactElement` — it type-checks as one — but it
  // forwards none of these props to anything inside it, so cloning it would
  // silently disconnect the label and the validation wiring from every real
  // element the Fragment contains. The type system cannot rule this out
  // (`Fragment`'s element type is indistinguishable from any other
  // component's at the type level), so it is checked at runtime instead.
  const isFragment = children.type === Fragment;
  devWarnOnce(
    !isFragment,
    "FieldShell: `children` must be a single element, not a Fragment. A Fragment forwards " +
      "no props to the elements inside it, so the id, aria-describedby and aria-invalid this " +
      "component computes would have nowhere to land — the label and the control would look " +
      "wired up and never actually connect. Wrap the intended elements in a real element " +
      "instead, such as a `<div>`."
  );
  // Cloning a Fragment with these props would only add React's own "invalid
  // prop supplied to React.Fragment" warning on top of the one above without
  // fixing anything, so it is rendered unmodified and the warning is the
  // only signal.
  const control = isFragment
    ? children
    : cloneElement(children, controlOverrides);

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
      <div className={controlWidth({ width })}>{control}</div>
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
