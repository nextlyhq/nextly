/**
 * The ways a stored binding can break the rules a binding is checked against,
 * as one closed table of codes.
 *
 * The table is the contract between the places that find a broken binding and
 * the places that tell an author about one. The renderer reports these codes
 * for the bindings it could not use, the validator reports the same codes when
 * it is given a schema, and an editor or a report shows them. A code added
 * here is a code every reader must expect, which is why the list is closed and
 * a test holds every emitted code to it.
 *
 * It lives in a module with no imports so the validator's own issue table can
 * be built from it without depending on the rules that emit it.
 *
 * @module binding-issues
 */

/**
 * Every binding issue code, each with a one-line description.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const BINDING_ISSUE_CODES = {
  "binding-malformed":
    "A binding is not an object with a field path, a known source and the key its source needs.",
  "binding-prop-missing":
    "A binding names a prop the block does not have, so it fills nothing.",
  "binding-prop-unbindable":
    "A binding names a prop whose type cannot be bound, so the prop keeps its own value.",
  "binding-path-too-deep": "A binding's path follows more than one relation.",
  "binding-path-to-many":
    "A binding's path goes through a field that holds a list, such as a to-many relation.",
  "binding-path-unsupported":
    "A binding's path follows a relation that can point at more than one collection.",
  "binding-field-missing":
    "A binding's path names a field its source does not have, or one the public may not read.",
  "binding-type-misfit":
    "A binding's field, or the value it holds, is not a type its prop can show.",
  "binding-format-misfit":
    "A binding's format is not one its field can take or its prop can hold.",
  "binding-format-invalid":
    "A binding's format has options a formatter would refuse, such as an unknown currency or locale.",
  "binding-format-unsupported":
    "A binding's format is not one this release formats, so its value is shown unformatted when it fits.",
  "binding-fallback-invalid":
    "A binding's fallback is not a valid value of its prop, so the prop's own value is shown instead.",
  "binding-source-unavailable":
    "A binding's source could not be read for this page, such as a list item outside a list.",
} as const;

/**
 * A stable binding issue code.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingIssueCode = keyof typeof BINDING_ISSUE_CODES;

/**
 * One binding that could not be used as stored, and why.
 *
 * Carries where the binding is and what is wrong with it, never the value the
 * source holds: a report is read by authors and written to logs, and a value
 * the public may not read must not reach either through it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingIssue {
  /** The node holding the binding. */
  readonly nodeId: string;
  /** The prop the binding fills. */
  readonly prop: string;
  readonly code: BindingIssueCode;
  /** A sentence an author can act on. */
  readonly message: string;
  /** The binding's stored path, or an empty string when it has none. */
  readonly path: string;
}
