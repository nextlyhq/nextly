/**
 * Server-side per-field validation (i18n M5b).
 *
 * Nextly historically had NO server-side per-field document validation — `required` was only a
 * DB `NOT NULL`, and `pattern`/`min`/`max`/custom `validate` were never enforced on the server
 * (spec §13). This is that validation step, built language-aware:
 *
 * - **`required` is enforced at the app layer.** For a LOCALIZED field it is enforced only for the
 *   default-language row (`enforceLocalizedRequired`), so the "publish English now, translate
 *   later" workflow works — other languages may be blank and fall back. Shared (non-localized)
 *   required fields are always enforced.
 * - `pattern` / `minLength` / `maxLength` / `min` / `max` / custom `validate` run on present,
 *   non-blank values regardless of locale.
 * - Produces per-field errors (`{ field, message }`) so callers can surface named messages
 *   ("German title is required") instead of the generic DB-constraint message.
 *
 * Pure and dependency-free (the custom `validate` fn may be async).
 *
 * @module domains/collections/validation/validate-fields
 */

import type { RequestContext } from "../../../shared/types";

/** A single field validation failure. */
export interface FieldError {
  field: string;
  message: string;
}

/** Minimal field shape this validator reads (structurally compatible with FieldConfig). */
export interface ValidatableField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  validation?: {
    required?: boolean;
    pattern?: string;
    message?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
  validate?: (
    value: unknown,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}

export interface ValidateFieldsOptions {
  /**
   * `true` for create (a required field that is absent/blank errors); `false` for update (only
   * fields PRESENT in `data` are checked — an omitted field keeps its stored value).
   */
  isCreate: boolean;
  /** Names of the localized (companion-owned) fields. */
  localizedFieldNames: Set<string>;
  /**
   * Whether localized-`required` fields must be enforced — `true` when writing the default locale
   * (or for a non-localized collection). When `false`, a blank localized-required field is allowed
   * (it falls back to the default language).
   */
  enforceLocalizedRequired: boolean;
  /** Request context passed to custom `validate` functions. */
  req: RequestContext;
}

/** Layout-only field types carry no value and are skipped. */
const LAYOUT_FIELD_TYPES = new Set(["ui", "row", "collapsible", "tabs"]);

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function labelOf(field: ValidatableField): string {
  return field.label ?? field.name;
}

/**
 * Validate `data` against `fields`. Returns all field errors (empty = valid). See the module
 * doc for the language-aware `required` rule.
 */
export async function validateFields(
  fields: ValidatableField[],
  data: Record<string, unknown>,
  opts: ValidateFieldsOptions
): Promise<FieldError[]> {
  const errors: FieldError[] = [];

  for (const field of fields) {
    if (!field?.name || LAYOUT_FIELD_TYPES.has(field.type)) continue;

    const present = Object.prototype.hasOwnProperty.call(data, field.name);
    const value = data[field.name];
    const blank = isBlank(value);
    const isLocalized = opts.localizedFieldNames.has(field.name);
    const required =
      field.required === true || field.validation?.required === true;

    // ── required (language-aware) ──────────────────────────────────────────
    if (required) {
      const requiredEnforced = isLocalized
        ? opts.enforceLocalizedRequired
        : true;
      if (requiredEnforced) {
        const missingOnCreate = opts.isCreate && blank;
        const blankedOnUpdate = !opts.isCreate && present && blank;
        if (missingOnCreate || blankedOnUpdate) {
          errors.push({
            field: field.name,
            message: `${labelOf(field)} is required`,
          });
          continue; // no point running format checks on a missing value
        }
      }
    }

    // Format/range/custom checks run only on present, non-blank values.
    if (!present || blank) continue;

    const v = field.validation;
    if (v?.pattern && typeof value === "string") {
      if (!new RegExp(v.pattern).test(value)) {
        errors.push({
          field: field.name,
          message: v.message ?? `${labelOf(field)} is invalid`,
        });
      }
    }
    if (typeof value === "string") {
      if (v?.minLength != null && value.length < v.minLength) {
        errors.push({
          field: field.name,
          message:
            v.message ??
            `${labelOf(field)} must be at least ${v.minLength} characters`,
        });
      }
      if (v?.maxLength != null && value.length > v.maxLength) {
        errors.push({
          field: field.name,
          message:
            v.message ??
            `${labelOf(field)} must be at most ${v.maxLength} characters`,
        });
      }
    }
    if (typeof value === "number") {
      if (v?.min != null && value < v.min) {
        errors.push({
          field: field.name,
          message: v.message ?? `${labelOf(field)} must be at least ${v.min}`,
        });
      }
      if (v?.max != null && value > v.max) {
        errors.push({
          field: field.name,
          message: v.message ?? `${labelOf(field)} must be at most ${v.max}`,
        });
      }
    }

    if (field.validate) {
      const result = await field.validate(value, { data, req: opts.req });
      if (result !== true) {
        errors.push({
          field: field.name,
          message:
            typeof result === "string" ? result : `${labelOf(field)} is invalid`,
        });
      }
    }
  }

  return errors;
}
