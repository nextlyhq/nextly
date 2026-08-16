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
  children: React.ReactNode;
}
