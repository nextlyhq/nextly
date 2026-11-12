/**
 * Which Email field one response per email may compare, and why a form's
 * choice is refused.
 *
 * Every accepted submission must carry the address it is compared by, so the
 * field must be an Email field, required, and never hidden by a condition: a
 * hidden or optional field lets a submission through with no address, and so
 * with no key. The builder, Settings and the save all ask this module.
 *
 * @module utils/one-response-field
 */
import type { AnyFormField, FormSettings } from "../types";

/** Why the chosen field cannot be made optional, conditional, or deleted. */
export const ONE_RESPONSE_FIELD_REASON =
  "This field is used for one response per person, so it stays required and always shown. Choose another Email field in Settings first.";

/** Whether `field` can be the Email field one response per email compares. */
export function comparesByEmail(field: AnyFormField): boolean {
  return (
    field.type === "email" &&
    field.required === true &&
    field.conditionalLogic?.enabled !== true
  );
}

/** The fields one response per email may compare, in the form's order. */
export function emailFieldsToCompare(
  fields: readonly AnyFormField[]
): AnyFormField[] {
  return fields.filter(comparesByEmail);
}

/**
 * Why a form's one response per email cannot stand as saved, or undefined
 * when it can (or the form does not compare by email).
 */
export function oneResponseFieldProblem(
  settings: Pick<FormSettings, "oneResponse" | "oneResponseField">,
  fields: readonly AnyFormField[]
): string | undefined {
  if (settings.oneResponse !== "email") return undefined;
  const name = settings.oneResponseField;
  if (!name) {
    return "One response per email address needs an Email field to compare. Choose one in Settings.";
  }
  const field = fields.find(each => each.name === name);
  if (!field || field.type !== "email") {
    return `One response per email address compares "${name}", which is not an Email field of this form.`;
  }
  return comparesByEmail(field)
    ? undefined
    : `The Email field one response per person compares, "${field.label || name}", must be required and not hidden by a condition.`;
}

/**
 * Why an edit of `before` into `after` is refused, or undefined: the field
 * one response per email compares may be renamed but not made optional,
 * conditional or another type.
 */
export function oneResponseEditProblem(
  before: AnyFormField,
  after: AnyFormField,
  settings: Pick<FormSettings, "oneResponse" | "oneResponseField">
): string | undefined {
  if (settings.oneResponse !== "email") return undefined;
  if (settings.oneResponseField !== before.name) return undefined;
  return comparesByEmail(after) ? undefined : ONE_RESPONSE_FIELD_REASON;
}
