/**
 * What the form's preview shows and checks, worked out the way a visitor
 * meets it: which fields are on the page as the answers stand, and what a
 * submission of those answers would be refused for.
 *
 * The checks are the submission's own (`generateZodSchema` over the answers
 * `transformFormData` shapes, reported by `getValidationIssues`), so the
 * preview cannot come to accept what the site refuses, or the reverse.
 *
 * @module admin/components/builder/preview-checks
 */
import { isKnownFormField, type AnyFormField } from "../../../types";
import { evaluateConditions } from "../../../utils/evaluate-conditions";
import {
  generateZodSchema,
  getValidationIssues,
  transformFormData,
} from "../../../utils/generate-schema";

/** What a blank answer to a required field is told. */
const REQUIRED_MESSAGE = "This field is required.";

/** Why a field is not on the visitor's page, when it is not. */
export type HiddenBecause = "hidden-field" | "condition";

/** One field of the preview: on the page, or why not. */
export interface PreviewField {
  field: AnyFormField;
  hidden?: HiddenBecause;
}

/**
 * Every field with whether a visitor would see it now. Visibility is worked
 * out in field order against the answers of fields that are themselves shown,
 * so a hidden field's leftover answer never keeps a later condition true.
 */
export function previewFields(
  fields: readonly AnyFormField[],
  values: Record<string, unknown>
): PreviewField[] {
  const shown: Record<string, unknown> = {};
  return fields.map(field => {
    if (field.type === "hidden") return { field, hidden: "hidden-field" };
    const visible =
      !field.conditionalLogic?.enabled ||
      evaluateConditions(field.conditionalLogic, shown);
    if (!visible) return { field, hidden: "condition" };
    if (field.name in values) shown[field.name] = values[field.name];
    return { field };
  });
}

/**
 * Whether the preview can check a field: a file cannot be attached here, and
 * a plugin's field draws a placeholder with no answer to give, so asking for
 * either would refuse every submission with no way to satisfy it.
 */
function checkable(field: AnyFormField): boolean {
  return isKnownFormField(field) && field.type !== "file";
}

/**
 * What submitting `values` would be refused for, by field name: the first
 * message per field, as the site would report it. Only the fields the
 * visitor sees are checked, since only they are on the page to answer.
 */
export function previewIssues(
  shown: readonly AnyFormField[],
  values: Record<string, unknown>
): Map<string, string> {
  const fields = shown.filter(checkable);
  const result = generateZodSchema(fields).safeParse(
    transformFormData(values, fields)
  );
  return new Map(
    getValidationIssues(result, values).map(issue => [
      issue.path,
      // A blank answer is said in words a person reads; the schema's own text
      // for it names types. Any other refusal is the site's own message.
      issue.code === "REQUIRED" ? REQUIRED_MESSAGE : issue.message,
    ])
  );
}
