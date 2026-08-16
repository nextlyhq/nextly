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

/**
 * The wiring `FieldShell` computes for its control: the id to attach, the
 * composed `aria-describedby` (`undefined` when nothing is rendered to point
 * at), and whether a rendered `error` forces the control invalid (`undefined`
 * when there is no error to force one way or the other).
 *
 * A render-function `children` (see `FieldShellProps`) receives exactly this
 * object — the SAME computation the element-clone path derives its
 * `cloneElement` overrides from — so a caller wiring a compound control (a
 * Radix `Select`'s trigger, for example) gets precisely the values the
 * simple, single-element case would have applied.
 * @experimental
 */
export interface FieldShellRenderProps {
  id: string;
  describedBy: string | undefined;
  invalid: boolean | undefined;
}

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
   * Either a single element to clone, or a function that receives the
   * computed wiring and applies it itself.
   *
   * The element form is `FieldShell` cloning it with `cloneElement` to
   * attach the id, `aria-describedby` and `aria-invalid` it computes —
   * unchanged from before, and still the right choice for an atomic control
   * (`Input`, `Textarea`, `Switch`) that spreads its own props onto a real
   * DOM node. Typing this branch as `ReactNode` would let a composite field
   * (two inputs with a unit between them, for example) compile and then
   * crash on mount, so it stays a single `ReactElement` — wrap several
   * elements in one real element, a `<div>`, not a `<Fragment>`: a Fragment
   * forwards none of those props to what is inside it.
   *
   * The function form exists for a compound control built on a Radix `Root`
   * (`Select`, and by the same shape `RadioGroup`): `Root` destructures a
   * fixed, named prop list and never spreads the remainder, so `id` handed
   * to it via `cloneElement` is silently dropped rather than reaching the
   * actual focusable element two levels down (`Select` > `SelectTrigger` >
   * `SelectValue`). A render function is called with `FieldShellRenderProps`
   * and applies `id`/`describedBy`/`invalid` to whichever nested element is
   * the real control, instead of relying on a single top-level clone that
   * can never reach it.
   */
  children:
    | React.ReactElement
    | ((field: FieldShellRenderProps) => React.ReactNode);
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
