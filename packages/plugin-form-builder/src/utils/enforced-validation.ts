/**
 * Which validation rules this runtime actually enforces, per field type.
 *
 * Core's `validationRulesForFieldType` answers what a type MEANS — what a field
 * of that type could sensibly be bounded by. This answers a narrower and quite
 * different question: which of those bounds the form's schema generator reads
 * back and applies. A rule a surface offers but the runtime ignores is worse
 * than no control at all, because the author configures a restriction, believes
 * the form is guarded, and submissions violating it still pass.
 *
 * **The answer is per type, and cannot be collapsed into one list.** A single
 * set of "rules this runtime enforces" only says a rule is honoured for SOME
 * type. Intersected with a type's vocabulary it then offers, for example, `min`
 * and `max` on a date — because the number schema honours them — while the date
 * schema reads its bounds from `field.min`/`field.max` and never looks at
 * `validation`. The control stores a bound nothing reads. The same collapse
 * offers length limits on email, a pattern on textarea, and all three on time
 * and hidden.
 *
 * Each row below is what its generator in `generate-schema.ts` reads, and the
 * test beside this file asserts every entry CHANGES what the generated schema
 * accepts for that specific type — so a row that stops being true fails rather
 * than quietly becoming an inert control.
 *
 * Kept free of `zod` and of the generator itself on purpose. The field editor
 * needs this metadata to decide what to draw, and importing it from the module
 * that builds schemas would ship the whole schema implementation and the
 * validation library to every admin client, before anyone opens a field.
 *
 * @module utils/enforced-validation
 */

import type { FieldValidationRule } from "nextly/field-catalog";

import type { FormFieldType } from "../types";

/**
 * `message` appears on every row because it is honoured everywhere: each
 * generator passes `validation.errorMessage` to `applyRequired`, so even a type
 * with no bounds of its own uses it for the required failure.
 *
 * Typed as a total `Record` rather than a partial one, so adding a field type
 * without deciding what it enforces is a compile error instead of a type that
 * silently offers nothing.
 */
export const ENFORCED_VALIDATION_RULES: Record<
  FormFieldType,
  readonly FieldValidationRule[]
> = {
  text: ["minLength", "maxLength", "pattern", "message"],
  // Length bounds are deliberately absent: the email schema applies its own
  // format check and a pattern, and reads neither `minLength` nor `maxLength`.
  email: ["pattern", "message"],
  number: ["min", "max", "message"],
  phone: ["pattern", "message"],
  url: ["pattern", "message"],
  // No pattern: the textarea schema reads only the two length bounds.
  textarea: ["minLength", "maxLength", "message"],
  select: ["message"],
  checkbox: ["message"],
  radio: ["message"],
  // A file's size limit is stored on the field itself, not under `validation`.
  file: ["message"],
  // The date schema reads `field.min`/`field.max` — top level, not `validation`
  // — so a `validation.min` written here would never be consulted.
  date: ["message"],
  time: ["message"],
  hidden: ["message"],
};

/**
 * The rules a field of this type both accepts and has enforced.
 *
 * A plugin-contributed type has no row, and correctly gets nothing: this
 * runtime's generator has no clause for it, so every rule would be inert.
 */
export function enforcedValidationRules(
  type: string
): readonly FieldValidationRule[] {
  return ENFORCED_VALIDATION_RULES[type as FormFieldType] ?? [];
}
