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

export type { ValidationIssue };

/**
 * A field declaration written against this API.
 *
 * The validator's own parameter type is a minimal structural shape — enough for
 * it to read what it needs from configs that already exist. Authoring against
 * that shape is a different job: a caller writing `{ type: "text", maxLength: 80 }`
 * or a plugin type's own option needs those keys to be admissible, which they
 * are not on a closed interface. The rules the validator actually reads are
 * named here, and anything else is left open for a field type's own options.
 */
export interface FieldValueDeclaration {
  /**
   * Column/property name the value is keyed by.
   *
   * Required here, unlike the internal shape: the validator skips any field
   * without one, so a hand-authored declaration that omitted it would report
   * success without having checked anything.
   */
  name: string;
  /** Built-in field type, or a plugin-contributed one. */
  type: string;
  /** Whether an absent or empty value is refused. */
  required?: boolean;
  /** Whether the value is a list. */
  hasMany?: boolean;
  /** Choices for `select` and `radio`. */
  options?: unknown;
  /** Nested declarations for `repeater`, `group` and component fields. */
  fields?: FieldValueDeclaration[];
  /** Rules the built-in checks read, flat or under `validation`. */
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minRows?: number;
  maxRows?: number;
  pattern?: string;
  validation?: Record<string, unknown>;
  /** Options belonging to the field's own plugin type. */
  pluginOptions?: Record<string, unknown>;
  /** Anything else the declared type reads for itself. */
  [option: string]: unknown;
}

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
 * What this accepts as a declaration.
 *
 * `FieldValueDeclaration` is for writing one by hand, where the rule keys and a
 * type's own options have to be admissible. `ValidatableField` is the minimal
 * shape the field configs already in the codebase satisfy, so a caller holding
 * a `FieldConfig[]` passes it straight through. Neither is assignable to the
 * other — the open one has an index signature the closed one lacks — so the
 * input admits both rather than forcing one side to cast.
 */
export type FieldValueDeclarationInput =
  | FieldValueDeclaration
  | ValidatableField;

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
  fields: readonly FieldValueDeclarationInput[],
  options: ValidateFieldValuesOptions = {}
): Promise<ValidationIssue[]> {
  // Both arms describe the same field, one open for authoring and one the
  // minimal shape existing configs already satisfy; the validator reads only
  // what the minimal shape names.
  return validateEntryData(values, [...fields] as ValidatableField[], {
    mode: options.mode ?? "create",
    req: options.req,
  });
}
