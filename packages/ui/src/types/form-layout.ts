/**
 * How wide a field's CONTROL may grow.
 *
 * Named rather than measured so a page cannot invent a one-off width, which is
 * how the eight admin forms diverged. The caps read from custom properties with
 * literal fallbacks, so a theme can retune them centrally without this file
 * changing and without a page overriding them locally.
 * @experimental
 */
export type FieldWidth = "half" | "full" | "fill";

/** @experimental */
export interface FieldShellProps {
  label?: React.ReactNode;
  /** Helper text under the control. Rendered only when present. */
  description?: React.ReactNode;
  /** Validation message under the control. Rendered only when present. */
  error?: React.ReactNode;
  /** Defaults to "half": most admin inputs are short values. */
  width?: FieldWidth;
  htmlFor?: string;
  className?: string;
  /**
   * Exactly one element: the control this field wraps. `FieldShell` clones it
   * with `cloneElement` to attach the id, `aria-describedby` and
   * `aria-invalid` it computes, rather than rendering a wrapper. Typing this
   * as `ReactNode` would let a composite field (two inputs with a unit
   * between them, for example) compile and then crash on mount. A caller
   * with several elements to slot in wraps them in one — a `<div>`, not a
   * `<Fragment>`: a Fragment forwards none of those props to what is inside
   * it, so the element must be single and DOM-bearing for the clone to have
   * anywhere to land them.
   */
  children: React.ReactElement;
}

/**
 * The page measure. "form" suits most pages; "wide" is opt-in for dense ones.
 * @experimental
 */
export type FormMeasure = "form" | "wide";

/** @experimental */
export interface FormLayoutProps {
  width?: FormMeasure;
  className?: string;
  children: React.ReactNode;
}

/** @experimental */
export interface FormActionsProps {
  /**
   * Whether the form has unsaved changes. Supplied by the page from the form
   * state that already tracks it; never computed here.
   */
  dirty?: boolean;
  className?: string;
  children: React.ReactNode;
}
