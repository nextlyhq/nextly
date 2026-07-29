/**
 * Validating values against field declarations, for code outside core.
 *
 * A plugin that stores structured content of its own — a page builder holding
 * block props, a form builder holding submissions — has field declarations and
 * values that must satisfy them. Re-deriving the rules would mean a second
 * implementation of `required`, of the per-type checks, and of every plugin
 * field type's `validate`, which would drift from the one writes go through.
 *
 * A deliberately narrower surface than the internal entry validator. Options
 * that belong to a collection write, such as which fields a localized entity
 * keeps in its companion row, are not exposed: they describe a stored entity,
 * and a caller holding a loose set of values has no entity to answer for.
 *
 * @module plugins/validate-field-values
 */
import type {
  ValidatableField,
  ValidationIssue,
} from "../shared/lib/entry-validation";
import { validateEntryData } from "../shared/lib/entry-validation";

export type { ValidatableField, ValidationIssue };

export interface ValidateFieldValuesOptions {
  /**
   * Whether absent means unset or untouched.
   *
   * `"create"` enforces `required` on a field the values omit. `"update"` takes
   * an omitted field as unchanged and leaves it alone. Content written whole —
   * a block's props are replaced entirely on every save — is `"create"` even
   * when it is replacing something, because nothing carries over.
   *
   * @default "create"
   */
  mode?: "create" | "update";
  /** Request context forwarded to a field's own `validate`. */
  req?: Record<string, unknown>;
}

/**
 * Check `values` against `fields`, returning every violation rather than the
 * first, so a caller can report or repair a whole object in one pass.
 *
 * Runs the same rules a write does, in the same order: the built-in checks for
 * the field's type, then a plugin field type's own `validate`, then the field's
 * `validate`. Issue paths are absolute and index a row in brackets
 * (`rows[0].title`), so a value nested in a container reports where it sits.
 */
export async function validateFieldValues(
  values: Record<string, unknown>,
  fields: readonly ValidatableField[],
  options: ValidateFieldValuesOptions = {}
): Promise<ValidationIssue[]> {
  return validateEntryData(values, [...fields], {
    mode: options.mode ?? "create",
    req: options.req,
  });
}
