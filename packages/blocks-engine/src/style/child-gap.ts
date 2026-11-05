/**
 * The two declarations a container's child gap is written as, and the one
 * test of whether a value can be.
 *
 * In block flow the gap is a top margin on every child after the first; under
 * flex or grid it is the container's `gap`. A container moves between the two
 * whenever its display changes, so a value only one of them takes would space
 * the children in one mode and lose the spacing in the other: `-1rem` is a
 * margin and never a gap, `auto` only a margin, `normal` and a second length
 * only a gap. A child gap is therefore usable exactly when the catalog takes
 * it as BOTH, and registration and the compiler both ask through the forms
 * below, so the two cannot disagree about which values those are.
 *
 * @module style/child-gap
 */
import type { ValidationIssue } from "../validation";

import { validateStyleValues } from "./validate-style-value";

/** A child gap as the style map each of its two declarations comes from. */
export interface ChildGapForms {
  /** Block flow: the top margin on every child after the first. */
  readonly flow: Readonly<Record<string, unknown>>;
  /** Flex or grid: the container's own `gap`. */
  readonly spaced: Readonly<Record<string, unknown>>;
}

/** The style maps a child gap compiles from, one per layout mode. */
export function childGapForms(value: unknown): ChildGapForms {
  return { flow: { margin: { blockStart: value } }, spaced: { gap: value } };
}

/**
 * Why a value cannot be a child gap, or nothing when it can: every error the
 * catalog reports against either form. No site tokens are consulted, so a
 * `{ $token }` reference is judged by its shape alone; what it resolves to is
 * the site's, and the compiler judges that.
 */
export function childGapIssues(
  value: unknown,
  basePath: string
): ValidationIssue[] {
  const forms = childGapForms(value);
  return [forms.flow, forms.spaced].flatMap(form =>
    validateStyleValues(form, basePath, "strict").filter(
      issue => issue.severity === "error"
    )
  );
}
