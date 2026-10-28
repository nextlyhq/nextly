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

import { STORAGE_PRIMITIVE_AS_FIELD_TYPE } from "../../collections/fields/catalog";
import { isVirtualField } from "../../collections/fields/virtual";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../domains/field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../domains/field-groups/storage/field-group-type-key";
import { getFieldType } from "../../domains/schema/field-types/field-type-registry";
import { numberFieldStoresFractions } from "../../domains/schema/services/field-column-descriptor";
import type { ValidationPublicData } from "../../errors/public-data";
import type {
  PluginFieldType,
  PluginFieldWrite,
  PluginStoredValue,
  PluginStoredValueTarget,
} from "../../plugins/contributions";

import { detachedField } from "./detached-field";
import { applyFieldDefaults } from "./field-defaults";
import {
  attachFieldValidators,
  getFieldFunctions,
} from "./field-level-registry";

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
  // `string`, not the strict field-type union: this shape is satisfied by
  // both code-first FieldConfig[] and runtime FieldDefinition[], whose
  // `type` unions differ, so `string` is their only common supertype.
  type: string;
  label?: unknown;
  required?: boolean;
  /** The root virtual flag; see `isVirtualField` for both spellings. */
  virtual?: boolean;
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
  /**
   * Names of the localized (companion-owned) fields for a localized-collection write. A localized
   * field stores its value per language in the `_locales` companion row, so its `required` rule is
   * enforced only for the default-locale write (see `enforceLocalizedRequired`); other locales may
   * be blank and fall back to the default language. Absent → no field is treated as localized.
   */
  localizedFieldNames?: ReadonlySet<string>;
  /**
   * Whether localized-`required` fields are enforced on this write. `true` (the default, i.e. when
   * omitted) for the default-locale write or a non-localized collection; `false` lets a blank
   * required LOCALIZED field pass because it falls back to the default language.
   */
  enforceLocalizedRequired?: boolean;
  /**
   * Whether an empty value is the value being judged rather than an omission.
   *
   * A submission that arrives empty means "not provided", so only `required`
   * has anything to say about it. A resolved DEFAULT that is empty is different:
   * it is what the config states the column will hold, so it still has to
   * satisfy that column. Without this an empty default reaches the insert with
   * neither the storage-primitive check nor the type's own `validate` having
   * run — a number-backed `defaultValue: () => ""` fails at the database, or
   * stores the wrong representation on SQLite.
   *
   * `null` and `undefined` are unaffected: they mean no value under either
   * reading, and the callers that seed defaults filter them out first.
   */
  emptyIsAValue?: boolean;
  /**
   * Whether the document was assembled from storage rather than carried by
   * the caller — a publish merging the stored row with the caller's patch, a
   * promoted working draft, a go-live document judged per language.
   *
   * Every rule still judges this document whole: that is what stops an
   * untouched stored value from reading as missing. The whole-number rule is
   * the one exception, because it alone binds values a CALLER writes — each
   * value the caller carried was already judged, and refused, at its own
   * patch gate on the way in. A stored fraction (SQLite holds 2.5 where a
   * pre-fix write put it, MySQL's column already rounded it) rides through
   * these views unchanged, and the column decides at the write, as it
   * always has.
   */
  assembledFromStorage?: boolean;
  /**
   * The entry write being validated, for the field types that judge a value
   * against stored rows. Absent where no entry write is behind the validation,
   * and then no type is handed one.
   */
  write?: EntryWriteContext;
  /**
   * A component's fields by its slug. A component held inside a group or a
   * repeater is stored in that container's value, so the component write,
   * which validates a component's own fields, never reaches it; with this,
   * its value is validated against its component's fields here, its own
   * `validate` functions included. A component at the top level is left to
   * the component write, so nothing is judged twice. Absent: such a nested
   * component is not judged, as before.
   */
  componentFields?: (slug: string) => ValidatableField[] | undefined;
  /** Set by the walk itself once it is inside a group or repeater's value. */
  insideContainer?: boolean;
}

/**
 * Which entry a validation is for, and a stored read on the write's own
 * connection.
 *
 * The read takes the field type it is scoped to as an ARGUMENT, and each plugin
 * type is handed a read already bound to its own type ({@link fieldWriteFor}).
 * So the scope is decided here, by which validator is running, and no
 * validator can widen it by naming a different type.
 */
export interface EntryWriteContext {
  readonly kind: PluginFieldWrite["kind"];
  readonly slug: string;
  readonly id?: string;
  readonly inTransaction: boolean;
  readStored(
    allowedType: string,
    target: PluginStoredValueTarget
  ): Promise<PluginStoredValue>;
}

/** The write as one field type's validator may see it. */
function fieldWriteFor(
  write: EntryWriteContext,
  type: string
): PluginFieldWrite {
  return {
    kind: write.kind,
    slug: write.slug,
    ...(write.id === undefined ? {} : { id: write.id }),
    inTransaction: write.inTransaction,
    readStored: target => write.readStored(type, target),
  };
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

/**
 * Whether the field's number values may carry a fraction. The opt-in answer
 * is the descriptor's own — `numberFieldStoresFractions` there owns the
 * question, so validation and the column cannot drift. This wrapper adds
 * what the descriptor's column question does not cover: a hasMany number
 * stores a JSON list, but the rule follows the field's whole-number
 * semantics, not the physical column; and a plugin-contributed type
 * rerouted here by its storage primitive is not a `number` field at all —
 * its primitive stores numbers as integers unconditionally, so it is never
 * exempt.
 */
function fieldJudgesFractions(field: ValidatableField): boolean {
  if (field.type !== "number") return false;
  return numberFieldStoresFractions(field);
}

/**
 * The whole-number floor, judged over the keys a beforeChange hook changed.
 *
 * The hooks run after the validation gate and may transform or set any
 * value, so what they leave behind is a write this gate never saw: a hook
 * that produces a fraction would reach an integer column and let the
 * database decide — the dialect divergence the whole-number rule exists to
 * remove. Compared by reference against the snapshot taken before the hooks
 * ran: a number, string or boolean a hook leaves is always a replacement,
 * and a container a hook mutates in place is outside this check (the slug
 * re-sanitize after the same hooks reads the same top level).
 *
 * Only number fields are judged — every other rule keeps its pre-hook
 * verdict — and hasMany elements are judged as values, indexed in the path.
 */
export function hookChangedWholeNumberIssues(
  snapshot: Record<string, unknown>,
  data: Record<string, unknown>,
  fields: ValidatableField[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byName = new Map(
    fields
      .filter(field => typeof field.name === "string")
      .map(field => [field.name as string, field])
  );
  for (const key of Object.keys(data)) {
    if (data[key] === snapshot[key]) continue;
    const field = byName.get(key);
    // A fraction-capable field (decimal, float) keeps fractions; a
    // whole-number field is the one the floor judges.
    if (!field || fieldJudgesFractions(field)) continue;
    const label = typeof field.label === "string" ? field.label : field.name;
    const value = data[key];
    const elements = field.hasMany && Array.isArray(value) ? value : [value];
    elements.forEach((element, index) => {
      if (
        typeof element !== "number" ||
        Number.isNaN(element) ||
        Number.isInteger(element)
      ) {
        return;
      }
      issues.push({
        path: field.hasMany ? `${key}[${index}]` : key,
        code: "INVALID_TYPE",
        message: `${label} must be a whole number.`,
      });
    });
  }
  return issues;
}

/**
 * Whether a write is judged against this field at all.
 *
 * A virtual field stores nothing: a value sent for it is dropped before the
 * write and its value is computed after a read. Neither its `required` rule
 * nor any other has a stored value to hold, so a create that correctly omits
 * it is not missing anything, and a value that is about to be discarded is
 * not one to refuse. Exported because anything deciding whether a document
 * would pass this validator has to leave the same fields out.
 */
export function isJudgedOnWrite(field: ValidatableField): boolean {
  return !isVirtualField(field);
}

/**
 * Whether a field declares itself required, in either spelling.
 *
 * Exported because anything deciding whether a value is missing has to agree
 * with the validator that will reject it. `required: true` on the field and
 * `validation: { required: true }` beside its other rules are both supported,
 * and a caller testing only the first calls a field optional that the next
 * write refuses.
 */
export function isRequired(field: ValidatableField): boolean {
  return Boolean(field.required) || Boolean(rule(field, "required"));
}

/**
 * Whether a field's `required` rule applies to THIS write (i18n M5b). A top-level localized field
 * is required only for the default-locale write; other locales fall back to the default language,
 * so a blank value is allowed. Non-localized fields, nested fields, and non-localized collections
 * always enforce. Gated on `path === field.name` so a nested sub-field that happens to share a
 * top-level localized field's name is never relaxed.
 */
function requiredIsEnforced(
  field: ValidatableField,
  path: string,
  options: ValidateEntryOptions
): boolean {
  if (
    options.enforceLocalizedRequired === false &&
    field.name != null &&
    path === field.name &&
    options.localizedFieldNames?.has(field.name)
  ) {
    return false;
  }
  return true;
}

/**
 * What "no value" means for a required field, in one place.
 *
 * Exported because a caller deciding whether a document it assembled would
 * satisfy the schema has to ask the same question this validator will ask of
 * it later. A narrower second implementation (a nullish check, say) calls a
 * whitespace string or an empty array present, stores the document, and the
 * next write rejects it.
 */
export function isEmptyRequiredValue(value: unknown): boolean {
  return isEmpty(value);
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

/**
 * Whether JSON can represent a value at all.
 *
 * Deliberately narrower than the rule a block document answers to, which also
 * refuses values JSON reshapes rather than rejects — an `undefined` member, a
 * Map, a NaN. A json field carries ordinary data from ordinary callers, and
 * `{ note: undefined }` is normal JavaScript for a field that declares no
 * shape. What cannot pass is what would throw on write or store nothing.
 */
function isJsonRepresentable(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/** Date-only (YYYY-MM-DD) or anything Date.parse accepts. */
function isValidDateValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * The write the pass started from, as opposed to whatever the recursion is
 * currently walking.
 *
 * Both differ from what the recursion carries inside a repeater row or group:
 * the walked `data` is the row, and `options.mode` is forced to "create" there
 * because a row is a complete object whose required fields must all be present.
 * Neither is true of the write itself, and a plugin validator is told about the
 * write — it asks "is this an update?" meaning the operation, not the nesting.
 */
interface WriteContext {
  data: Record<string, unknown>;
  mode: "create" | "update";
}

/**
 * Validate one value against one field's rules, appending issues.
 * `path` is the dotted/bracketed location for the admin's error mapping.
 * `data` is the object this field lives on (a repeater row or group for a
 * nested field); `write` is the operation the pass started from.
 */
async function validateFieldValue(
  field: ValidatableField,
  value: unknown,
  path: string,
  data: Record<string, unknown>,
  write: WriteContext,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  const label = typeof field.label === "string" ? field.label : field.name;

  // A password field is write-only: the admin edit form seeds it with `""`
  // to mean "keep the stored hash", and hashPasswordFieldValues drops empty
  // password keys before the write. On update an empty password is therefore
  // a no-op, not a cleared required field, so it must not raise REQUIRED.
  // (An explicit `null` still falls through to the empty-value handling below
  // because null is an intentional clear.) Create keeps requiring it: a
  // required password genuinely must be set the first time.
  if (
    field.type === "password" &&
    options.mode === "update" &&
    (value === undefined || (typeof value === "string" && value.trim() === ""))
  ) {
    return;
  }

  // Empty values only ever violate required-ness; type/range rules apply
  // to actual values. Exception: a PROVIDED empty array on a list-shaped
  // field still runs its row/chip bounds (an explicit `[]` with minRows 1
  // is a bounds violation, not an absent value).
  const isProvidedEmptyList =
    Array.isArray(value) &&
    value.length === 0 &&
    (field.type === "chips" || field.type === "repeater");
  // A non-hasMany select/radio holds a scalar; an array (including `[]`) is a
  // shape error, not an absent value, so don't let the empty-value early
  // return swallow it — the select/radio branch below rejects the shape.
  const isScalarChoiceArray =
    Array.isArray(value) &&
    !field.hasMany &&
    (field.type === "select" || field.type === "radio");
  const emptyIsOmission =
    !options.emptyIsAValue || value === null || value === undefined;
  if (
    isEmpty(value) &&
    emptyIsOmission &&
    !isProvidedEmptyList &&
    !isScalarChoiceArray
  ) {
    if (isRequired(field) && requiredIsEnforced(field, path, options)) {
      issues.push({
        path,
        code: "REQUIRED",
        message: `${label} is required.`,
      });
    }
    return;
  }

  // A plugin-contributed type is not one of the cases below, so on its own it
  // would reach the column with nothing checked: a `number`-backed type would
  // accept the string "3". The storage primitive it declares is exactly the
  // statement of what its column holds, so the built-in rules for that
  // primitive's equivalent type are the ones that apply. Built-ins resolve to
  // themselves — a plugin cannot redefine one, so this never reroutes them.
  const pluginType = getFieldType(field.type);
  const effectiveType = pluginType
    ? STORAGE_PRIMITIVE_AS_FIELD_TYPE[pluginType.storage]
    : field.type;
  const issuesBeforePrimitive = issues.length;

  switch (effectiveType) {
    case "text":
    case "textarea":
    case "email":
    case "password":
    case "code": {
      // hasMany text stores an array of strings; a scalar for a hasMany
      // field (or an array for a single field) contradicts the schema.
      if (field.hasMany && !Array.isArray(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be a list.`,
        });
        break;
      }
      const values = field.hasMany ? (value as unknown[]) : undefined;
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
      // A hasMany number stores an array; a scalar contradicts the schema.
      if (field.hasMany && !Array.isArray(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be a list.`,
        });
        break;
      }
      const values = field.hasMany ? (value as unknown[]) : undefined;
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
        // A whole-number field says what it stores: a fraction is refused
        // with the field named, before any write, on every dialect — not
        // left to the column, where MySQL rounds it away silently,
        // PostgreSQL answers a 500, and SQLite stores a value the schema
        // never declared. On an assembled-from-storage document the caller's
        // own values were already judged at their patch gate, and the stored
        // ones were carried by nobody, so they ride unchanged.
        if (
          !fieldJudgesFractions(field) &&
          !options.assembledFromStorage &&
          !Number.isInteger(v)
        ) {
          issues.push({
            path: p,
            code: "INVALID_TYPE",
            message: `${label} must be a whole number.`,
          });
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
      // A scalar select/radio holds exactly one option; only `hasMany` stores
      // a list. Without this guard an array on a scalar field (e.g.
      // `["draft","published"]`) would pass element-by-element and then reach
      // a non-JSON column, so reject the shape rather than validate its items.
      // Mirrors the text/number branches, which also gate array vs scalar on
      // `hasMany`. Shape validity is independent of option membership, so this
      // must run even when no options are configured.
      if (Array.isArray(value) !== Boolean(field.hasMany)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: field.hasMany
            ? `${label} must be a list.`
            : `${label} must be a single option.`,
        });
        break;
      }
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
          // A malformed row (null, primitive, or nested array) is a schema
          // violation and must be reported, not silently skipped past the
          // nested validation on its way to persistence.
          if (row === null || typeof row !== "object" || Array.isArray(row)) {
            issues.push({
              path: `${path}[${i}]`,
              code: "INVALID_TYPE",
              message: `${label} rows must be objects.`,
            });
            continue;
          }
          await validateFields(
            field.fields,
            row as Record<string, unknown>,
            write,
            `${path}[${i}]`,
            // Rows are complete objects, so nested required-ness applies.
            { ...options, mode: "create", insideContainer: true },
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
          write,
          path,
          { ...options, mode: "create", insideContainer: true },
          issues
        );
      }
      break;
    }

    case "json": {
      // A json column holds whatever JSON can represent, and a bigint or a
      // cycle is not that: serialization throws on it further down the write,
      // surfacing as a server error rather than as a rejected value. A bare
      // function or symbol encodes to nothing at all, which would store the
      // field as absent rather than as what was sent.
      if (!isJsonRepresentable(value)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${label} must be JSON-serializable.`,
        });
      }
      break;
    }

    // relationship/upload/component values are shaped by their own
    // normalization passes and referential checks; no scalar rules apply. A
    // component inside a container is the exception: nothing else judges it.
    default:
      if (options.insideContainer && isFieldGroupFieldType(field.type)) {
        await validateContainedComponents(
          field,
          value,
          path,
          write,
          options,
          issues
        );
      }
      break;
  }

  // A plugin-contributed type states its own rules through the registry. The
  // switch above has just checked the value against its storage primitive,
  // which for `json` means "is it JSON" and nothing more, so without this a
  // type could say nothing about what it accepts. Before the per-field
  // `validate` below, so a schema author's own rule composes on top of the
  // type's rather than replacing it.
  // Only for a value that is at least the right shape. A validator reasons
  // about ratings, not about whether it was handed the string "3", and running
  // it on a value the primitive already refused would either report the same
  // write twice or force every plugin author to re-check the type first.
  if (pluginType?.validate && issues.length === issuesBeforePrimitive) {
    await validatePluginFieldType(
      pluginType.validate,
      field,
      value,
      path,
      label,
      write,
      options,
      issues
    );
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

/** A message the API can show as-is: one sentence, ending in a period. */
function asSentence(message: string): string {
  return message.endsWith(".") ? message : `${message}.`;
}

/**
 * Run the `validate` a plugin declared for this field's type.
 *
 * A failure here is the value's, not the server's: a validator that throws is
 * reported as a refusal, exactly as the per-field `validate` is, so a defective
 * plugin cannot turn a rejected write into a 500.
 */
async function validatePluginFieldType(
  validate: NonNullable<PluginFieldType["validate"]>,
  field: ValidatableField,
  value: unknown,
  path: string,
  label: string | undefined,
  write: WriteContext,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  const refuse = (message: string): void => {
    issues.push({ path, code: "CUSTOM", message });
  };

  try {
    const result = await validate(value, {
      data: write.data,
      req: options.req ?? {},
      field: detachedField(field),
      // The validator cannot work out where it sits — a type nested in a
      // repeater row has no way to know its index — so the location it would
      // need to build an issue path is given to it.
      path,
      // The operation, not `options.mode`: the latter is switched to "create"
      // while walking a repeater row, which says nothing about whether the
      // entry itself is being created.
      mode: write.mode,
      ...(options.write === undefined
        ? {}
        : { write: fieldWriteFor(options.write, field.type) }),
    });

    if (result === true) return;

    if (typeof result === "string") {
      refuse(asSentence(result));
      return;
    }

    if (Array.isArray(result)) {
      for (const issue of result) {
        issues.push({
          // A structured value can be wrong somewhere inside itself, so an
          // issue may address a position under this field; without one it
          // belongs to the field as a whole.
          path: issue.path ?? path,
          code: issue.code ?? "CUSTOM",
          message: asSentence(issue.message),
        });
      }
      return;
    }

    // Anything outside the documented union — `undefined` from a validator
    // that forgot to return, a `false` from one assuming boolean semantics —
    // is refused rather than read as consent. Silently accepting it would turn
    // a validator bug into no validation at all.
    refuse(`${label ?? "This field"} failed validation.`);
  } catch {
    refuse(`${label ?? "This field"} failed validation.`);
  }
}

/**
 * Whether a component field sits inside a group or repeater anywhere in
 * `fields`: the case {@link ValidateEntryOptions.componentFields} exists for,
 * so a caller resolves component schemas only when there is one to judge.
 * Iterative, with each field list visited once, so a definition that leads
 * back to itself ends.
 */
export function hasComponentInContainer(
  fields: readonly ValidatableField[],
  /**
   * Whether `fields` are themselves a container's: a component's own fields are, for a component
   * placed directly in them, since its value too is reached by no write of its own.
   */
  inContainer = false
): boolean {
  const seen = new Set<readonly ValidatableField[]>();
  const work: Array<[readonly ValidatableField[], boolean]> = [
    [fields, inContainer],
  ];
  for (let next = work.pop(); next; next = work.pop()) {
    const [list, inContainer] = next;
    if (seen.has(list)) continue;
    seen.add(list);
    for (const field of list) {
      if (inContainer && isFieldGroupFieldType(field.type)) return true;
      if (Array.isArray(field.fields)) {
        work.push([
          field.fields,
          inContainer || field.type === "group" || field.type === "repeater",
        ]);
      }
    }
  }
  return false;
}

/**
 * A component's value held inside a group or repeater, judged against the
 * component's own fields with its registered `validate` functions attached, as
 * the component write judges a top-level one. One instance, a repeatable
 * component's list, or a dynamic zone's rows, each under the component its
 * field names or, in a zone, the one the row names.
 */
async function validateContainedComponents(
  field: ValidatableField,
  value: unknown,
  path: string,
  write: WriteContext,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  const resolve = options.componentFields;
  if (!resolve) return;
  const { single, many } = extractFieldGroupReferences(field);
  const instances: Array<[unknown, string]> = Array.isArray(value)
    ? value.map((row, i) => [row, `${path}[${i}]`])
    : [[value, path]];
  for (const [instance, at] of instances) {
    if (instance === null || instance === undefined) continue;
    // The component write refuses a value that is not an object, and none
    // reaches this one, so the shape is refused here or it is stored as sent.
    if (typeof instance !== "object" || Array.isArray(instance)) {
      issues.push({
        path: at,
        code: "INVALID_TYPE",
        message: "Component data must be an object.",
      });
      continue;
    }
    const slug =
      single ??
      (many?.includes(readFieldGroupType(instance) ?? "")
        ? readFieldGroupType(instance)
        : undefined);
    const own = slug ? resolve(slug) : undefined;
    if (!slug || !own) continue;
    // Judged with its declared defaults filled, as the component write fills a
    // new instance's before judging it, so a required child the caller left to
    // its default is not refused. Filled on a copy: validation reports, and
    // the value written is the caller's.
    const filled = { ...(instance as Record<string, unknown>) };
    applyFieldDefaults(filled, own, getFieldFunctions("fieldGroup", slug));
    await validateFields(
      attachFieldValidators("fieldGroup", slug, own),
      filled,
      write,
      at,
      // A component's value is written whole, so its required fields apply.
      { ...options, mode: "create", insideContainer: true },
      issues
    );
  }
}

async function validateFields(
  fields: ValidatableField[],
  data: Record<string, unknown>,
  write: WriteContext,
  basePath: string,
  options: ValidateEntryOptions,
  issues: ValidationIssue[]
): Promise<void> {
  for (const field of fields) {
    if (!field.name) continue;
    if (!isJudgedOnWrite(field)) continue;
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    // Own keys only. Field names may be camelCase, so `toString` is a legal
    // one, and `in` would answer for the prototype: the field would read as
    // present on every update and carry the inherited function as its value.
    const provided = Object.hasOwn(data, field.name);

    // PATCH semantics: an absent key on update is untouched. On create,
    // absent required fields must still fail.
    if (!provided && options.mode === "update") continue;

    await validateFieldValue(
      field,
      provided ? data[field.name] : undefined,
      path,
      data,
      write,
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
  // The write is what every nested pass reports against: a validator on a
  // field inside a repeater row still needs the top-level siblings the row it
  // is walking does not carry, and the operation the nested walk overrides.
  await validateFields(
    fields,
    data,
    { data, mode: options.mode },
    "",
    options,
    issues
  );
  return issues;
}
