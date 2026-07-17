/**
 * Server-side entry validation against the resolved field definitions.
 *
 * Runs at the mutation choke points (collection createEntry/updateEntry and
 * the singles update path), so every writer — admin, REST, Direct API,
 * bulk, forms, agents — hits the same rules. The admin's client-side zod
 * schema mirrors these semantics for inline UX; this pass is the
 * enforcement the client schema cannot provide.
 *
 * Issues use the canonical `{ path, code, message }` shape from
 * `ValidationPublicData`, which the admin already maps onto form fields,
 * so server-side failures render inline without extra client work.
 *
 * Semantics:
 * - `create` validates required-ness for every field; `update` follows
 *   PATCH semantics — absent keys are untouched, but a provided key must
 *   satisfy its rules (including "required fields cannot be emptied").
 * - Both the flat (`field.minLength`) and nested (`field.validation.*`)
 *   rule formats are honored, matching the builder's storage shape.
 * - Patterns are compiled only when they pass the same safe-regex guard
 *   the schema definition layer uses, so a hostile stored pattern cannot
 *   become a ReDoS on the write path.
 * - Custom `validate` functions run after built-in rules (string return =
 *   error), matching their documented contract.
 */
import safeRegex from "safe-regex2";

import type { ValidationPublicData } from "../../errors/public-data";

export type ValidationIssue = ValidationPublicData["errors"][number];

/** Mirrors the definition layer's cap in dynamic-collection-validation. */
const MAX_REGEX_PATTERN_LENGTH = 200;

/** The signature every concrete field-config `validate` narrows from. */
export type CustomFieldValidator = (
  value: unknown,
  args: { data: Record<string, unknown>; req: Record<string, unknown> }
) => string | true | Promise<string | true>;

/**
 * The minimal field shape FieldConfig and FieldDefinition both satisfy.
 * `validate` uses method syntax on purpose: concrete configs type their
 * value parameter narrowly (e.g. `CheckboxFieldValue`), and only the
 * bivariant method form accepts those narrower signatures.
 */
export interface ValidatableField {
  name?: string;
  type: string;
  label?: unknown;
  required?: boolean;
  hasMany?: boolean;
  /**
   * Select/radio choices in FieldConfig shape; FieldDefinition reuses the
   * same key for storage options (an object), so consumers read through
   * `selectOptions()` which accepts only the array shape.
   */
  options?: unknown;
  fields?: ValidatableField[];
  validate?(
    this: void,
    value: never,
    args: { data: Record<string, unknown>; req: Record<string, unknown> }
  ): string | true | Promise<string | true>;
}

export interface ValidateEntryOptions {
  mode: "create" | "update";
  /** Request context forwarded to custom `validate` functions. */
  req?: Record<string, unknown>;
}

/** Flat-or-nested rule lookup (builder writes `validation.*`, code-first is flat). */
function rule(field: ValidatableField, key: string): unknown {
  const record = field as unknown as Record<string, unknown>;
  if (record[key] !== undefined) return record[key];
  const nested = record.validation as Record<string, unknown> | undefined;
  return nested?.[key];
}

function numberRule(field: ValidatableField, key: string): number | undefined {
  const v = rule(field, key);
  return typeof v === "number" ? v : undefined;
}

function isRequired(field: ValidatableField): boolean {
  return Boolean(field.required) || Boolean(rule(field, "required"));
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extract select/radio option values, tolerating both stored shapes:
 * FieldConfig's `options: [{label, value}]` array and FieldDefinition's
 * `options` storage-object (whose choices, when present, ride the same
 * key as an array).
 */
function selectOptionValues(field: ValidatableField): string[] {
  const raw = field.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(o =>
      o !== null && typeof o === "object"
        ? (o as { value?: unknown }).value
        : undefined
    )
    .filter((v): v is string => typeof v === "string");
}

/** Date-only (YYYY-MM-DD) or anything Date.parse accepts. */
function isValidDateValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Validate one value against one field's rules, appending issues.
 * `path` is the dotted/bracketed location for the admin's error mapping.
 */
async function validateFieldValue(
  field: ValidatableField,
  value: unknown,
  path: string,
  data: Record<string, unknown>,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  const label = typeof field.label === "string" ? field.label : field.name;

  // Empty values only ever violate required-ness; type/range rules apply
  // to actual values. Exception: a PROVIDED empty array on a list-shaped
  // field still runs its row/chip bounds (an explicit `[]` with minRows 1
  // is a bounds violation, not an absent value).
  const isProvidedEmptyList =
    Array.isArray(value) &&
    value.length === 0 &&
    (field.type === "chips" || field.type === "repeater");
  if (isEmpty(value) && !isProvidedEmptyList) {
    if (isRequired(field)) {
      issues.push({
        path,
        code: "REQUIRED",
        message: `${label} is required.`,
      });
    }
    return;
  }

  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "password":
    case "code": {
      // hasMany text stores an array of strings.
      const values = field.hasMany && Array.isArray(value) ? value : undefined;
      const singles = values ?? [value];
      for (let i = 0; i < singles.length; i++) {
        const v = singles[i];
        const p = values ? `${path}[${i}]` : path;
        if (typeof v !== "string") {
          issues.push({
            path: p,
            code: "INVALID_TYPE",
            message: `${label} must be text.`,
          });
          continue;
        }
        const minLength = numberRule(field, "minLength");
        const maxLength = numberRule(field, "maxLength");
        if (minLength !== undefined && v.length < minLength) {
          issues.push({
            path: p,
            code: "TOO_SHORT",
            message: `${label} must be at least ${minLength} characters.`,
          });
        }
        if (maxLength !== undefined && v.length > maxLength) {
          issues.push({
            path: p,
            code: "TOO_LONG",
            message: `${label} must be at most ${maxLength} characters.`,
          });
        }
        if (field.type === "email" && !EMAIL_RE.test(v)) {
          issues.push({
            path: p,
            code: "INVALID_FORMAT",
            message: `${label} must be a valid email address.`,
          });
        }
        const pattern = rule(field, "pattern");
        if (
          typeof pattern === "string" &&
          pattern.length > 0 &&
          pattern.length <= MAX_REGEX_PATTERN_LENGTH &&
          safeRegex(pattern)
        ) {
          let re: RegExp | undefined;
          try {
            re = new RegExp(pattern);
          } catch {
            // An uncompilable stored pattern is a schema defect, not a
            // reason to reject the write.
          }
          if (re && !re.test(v)) {
            const message = rule(field, "message");
            issues.push({
              path: p,
              code: "INVALID_FORMAT",
              message:
                typeof message === "string" && message.length > 0
                  ? message.endsWith(".")
                    ? message
                    : `${message}.`
                  : `${label} does not match the required format.`,
            });
          }
        }
      }
      break;
    }

    case "number": {
      const values = field.hasMany && Array.isArray(value) ? value : undefined;
      const singles = values ?? [value];
      for (let i = 0; i < singles.length; i++) {
        const v = singles[i];
        const p = values ? `${path}[${i}]` : path;
        if (typeof v !== "number" || Number.isNaN(v)) {
          issues.push({
            path: p,
            code: "INVALID_TYPE",
            message: `${label} must be a number.`,
          });
          continue;
        }
        const min = numberRule(field, "min");
        const max = numberRule(field, "max");
        if (min !== undefined && v < min) {
          issues.push({
            path: p,
            code: "TOO_LOW",
            message: `${label} must be at least ${min}.`,
          });
        }
        if (max !== undefined && v > max) {
          issues.push({
            path: p,
            code: "TOO_HIGH",
            message: `${label} must be at most ${max}.`,
          });
        }
      }
      break;
    }

    case "checkbox": {
      if (typeof value !== "boolean") {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be true or false.`,
        });
      }
      break;
    }

    case "date": {
      if (!isValidDateValue(value)) {
        issues.push({
          path,
          code: "INVALID_FORMAT",
          message: `${label} must be a valid date.`,
        });
      }
      break;
    }

    case "select":
    case "radio": {
      const allowed = selectOptionValues(field);
      // Option membership only enforceable when options are declared.
      if (allowed.length === 0) break;
      const values = Array.isArray(value) ? value : [value];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const p = Array.isArray(value) ? `${path}[${i}]` : path;
        if (typeof v !== "string" || !allowed.includes(v)) {
          issues.push({
            path: p,
            code: "INVALID_OPTION",
            message: `${label} must be one of the configured options.`,
          });
        }
      }
      break;
    }

    case "chips": {
      if (!Array.isArray(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be a list.`,
        });
        break;
      }
      const minChips = numberRule(field, "minChips");
      const maxChips = numberRule(field, "maxChips");
      if (minChips !== undefined && value.length < minChips) {
        issues.push({
          path,
          code: "TOO_FEW_ROWS",
          message: `${label} must have at least ${minChips} entries.`,
        });
      }
      if (maxChips !== undefined && value.length > maxChips) {
        issues.push({
          path,
          code: "TOO_MANY_ROWS",
          message: `${label} must have at most ${maxChips} entries.`,
        });
      }
      break;
    }

    case "repeater": {
      if (!Array.isArray(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be a list.`,
        });
        break;
      }
      const minRows = numberRule(field, "minRows");
      const maxRows = numberRule(field, "maxRows");
      if (minRows !== undefined && value.length < minRows) {
        issues.push({
          path,
          code: "TOO_FEW_ROWS",
          message: `${label} must have at least ${minRows} rows.`,
        });
      }
      if (maxRows !== undefined && value.length > maxRows) {
        issues.push({
          path,
          code: "TOO_MANY_ROWS",
          message: `${label} must have at most ${maxRows} rows.`,
        });
      }
      if (field.fields) {
        for (let i = 0; i < value.length; i++) {
          const row = value[i];
          if (row === null || typeof row !== "object") continue;
          await validateFields(
            field.fields,
            row as Record<string, unknown>,
            `${path}[${i}]`,
            // Rows are complete objects, so nested required-ness applies.
            { ...options, mode: "create" },
            issues
          );
        }
      }
      break;
    }

    case "group": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be an object.`,
        });
        break;
      }
      if (field.fields) {
        await validateFields(
          field.fields,
          value as Record<string, unknown>,
          path,
          { ...options, mode: "create" },
          issues
        );
      }
      break;
    }

    // relationship/upload/json/component values are shaped by their own
    // normalization passes and referential checks; no scalar rules apply.
    default:
      break;
  }

  // Custom validate runs after built-in rules (documented contract). A
  // string return is the error message; anything else passes. The cast
  // widens the config's narrowed value parameter back to the runtime
  // reality (the stored value is whatever the caller sent).
  if (typeof field.validate === "function") {
    const customValidate = field.validate as CustomFieldValidator;
    try {
      const result = await customValidate(value, {
        data,
        req: options.req ?? {},
      });
      if (typeof result === "string") {
        issues.push({
          path,
          code: "CUSTOM",
          message: result.endsWith(".") ? result : `${result}.`,
        });
      }
    } catch {
      issues.push({
        path,
        code: "CUSTOM",
        message: `${label} failed validation.`,
      });
    }
  }
}

async function validateFields(
  fields: ValidatableField[],
  data: Record<string, unknown>,
  basePath: string,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  for (const field of fields) {
    if (!field.name) continue;
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    const provided = field.name in data;

    // PATCH semantics: an absent key on update is untouched. On create,
    // absent required fields must still fail.
    if (!provided && options.mode === "update") continue;

    await validateFieldValue(
      field,
      data[field.name],
      path,
      data,
      options,
      issues
    );
  }
}

/**
 * Validate entry data against its field definitions. Returns every
 * violation (not just the first) so forms can render all errors at once.
 */
export async function validateEntryData(
  data: Record<string, unknown>,
  fields: ValidatableField[],
  options: ValidateEntryOptions
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  await validateFields(fields, data, "", options, issues);
  return issues;
}
