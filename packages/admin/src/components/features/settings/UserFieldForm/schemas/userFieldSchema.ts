import * as z from "zod";

import type {
  UserFieldType,
  UserFieldDefinitionRecord,
  CreateUserFieldPayload,
  UpdateUserFieldPayload,
} from "@admin/services/userFieldsApi";

// ============================================================
// Form Values Type
// ============================================================

export interface UserFieldFormValues {
  label: string;
  name: string;
  type: UserFieldType;
  required: boolean;
  defaultValue: string;
  options: { label: string; value: string }[];
  /** Multi-value select; fixed at creation because it picks the column type. */
  hasMany: boolean;
  /** Validation bounds as strings ("" = unconstrained), parsed at submit. */
  minLength: string;
  maxLength: string;
  minValue: string;
  maxValue: string;
  placeholder: string;
  description: string;
  isActive: boolean;
}

// ============================================================
// Constants
// ============================================================

/**
 * Reserved user field names mirroring the backend's RESERVED_USER_FIELD_NAMES.
 * Compared case-insensitively.
 *
 * Duplicated rather than imported: the canonical list lives in `nextly`, whose
 * root entry point is server-only, and this schema runs in the browser. The
 * copy exists to answer before a round trip — the server rejects a reserved
 * name regardless, so the two drifting costs a worse message, not a hole.
 */
const RESERVED_FIELD_NAMES = new Set([
  "id",
  "name",
  "email",
  "emailverified",
  "passwordhash",
  "passwordupdatedat",
  "image",
  "isactive",
  "createdat",
  "updatedat",
  "roles",
  "accounts",
  "password",
]);

/** Sentinel value for "No default" in Radix Select (which doesn't accept empty strings) */
export const NO_DEFAULT = "__none__";

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a snake_case field name from a label.
 * e.g. "Phone Number" -> "phone_number"
 */
export function generateFieldName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Types whose values are strings with length bounds. */
export const LENGTH_BOUND_TYPES: readonly UserFieldType[] = [
  "text",
  "textarea",
  "url",
  "phone",
];

/** Parse a bound input: "" means unconstrained (null). */
function parseBound(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The bounds that apply to the chosen type; others are cleared to null. */
function boundsForType(values: UserFieldFormValues): {
  minLength: number | null;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
} {
  const lengthy = LENGTH_BOUND_TYPES.includes(values.type);
  const numeric = values.type === "number";
  return {
    minLength: lengthy ? parseBound(values.minLength) : null,
    maxLength: lengthy ? parseBound(values.maxLength) : null,
    minValue: numeric ? parseBound(values.minValue) : null,
    maxValue: numeric ? parseBound(values.maxValue) : null,
  };
}

/**
 * Transform flat form values into the create API payload shape.
 */
export function formValuesToCreatePayload(
  values: UserFieldFormValues
): CreateUserFieldPayload {
  const payload: CreateUserFieldPayload = {
    name: values.name,
    label: values.label,
    type: values.type,
    required: values.required,
    defaultValue: values.defaultValue || null,
    hasMany: values.type === "select" ? values.hasMany : null,
    ...boundsForType(values),
    placeholder: values.placeholder || null,
    description: values.description || null,
    isActive: values.isActive,
  };

  if (values.type === "select" || values.type === "radio") {
    payload.options = values.options.filter(
      o => o.label.trim() && o.value.trim()
    );
  } else {
    payload.options = null;
  }

  return payload;
}

/**
 * Transform flat form values into the update API payload shape.
 */
export function formValuesToUpdatePayload(
  values: UserFieldFormValues
): UpdateUserFieldPayload {
  const payload: UpdateUserFieldPayload = {
    label: values.label,
    name: values.name,
    type: values.type,
    required: values.required,
    defaultValue: values.defaultValue || null,
    ...boundsForType(values),
    placeholder: values.placeholder || null,
    description: values.description || null,
    isActive: values.isActive,
  };

  if (values.type === "select" || values.type === "radio") {
    payload.options = values.options.filter(
      o => o.label.trim() && o.value.trim()
    );
  } else {
    payload.options = null;
  }

  return payload;
}

/**
 * Transform an API user field record into flat form values for editing.
 */
export function fieldToFormValues(
  field: UserFieldDefinitionRecord
): UserFieldFormValues {
  return {
    label: field.label,
    name: field.name,
    type: field.type,
    required: field.required,
    defaultValue: field.defaultValue ?? "",
    options: field.options ?? [],
    hasMany: field.hasMany ?? false,
    minLength: field.minLength != null ? String(field.minLength) : "",
    maxLength: field.maxLength != null ? String(field.maxLength) : "",
    minValue: field.minValue != null ? String(field.minValue) : "",
    maxValue: field.maxValue != null ? String(field.maxValue) : "",
    placeholder: field.placeholder ?? "",
    description: field.description ?? "",
    isActive: field.isActive,
  };
}

// ============================================================
// Zod Schema
// ============================================================

/**
 * What this form generates for a new field: lowercase and underscores.
 *
 * Narrower than what a name may be. The server also accepts camelCase, which is
 * what a `defineConfig()` field usually looks like. A house style for names the
 * form invents, not a rule about names that already exist.
 */
const GENERATED_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function buildUserFieldSchema(mode: "create" | "edit") {
  // Checked only while the form is inventing the name. In edit mode the input
  // is disabled, the stored value is submitted back untouched, and the server
  // refuses to change it regardless, so holding it to this form's house style
  // rejects nothing anyone could fix. It only makes a field the server
  // accepted, such as `phoneNumber`, impossible to relabel here.
  const nameSchema =
    mode === "create"
      ? z
          .string()
          .min(1, "Field name is required")
          .max(64)
          .regex(
            GENERATED_NAME_PATTERN,
            "Must start with a letter and contain only lowercase letters, numbers, and underscores"
          )
      : z.string();

  return z
    .object({
      label: z.string().min(1, "Label is required").max(255),
      name: nameSchema,
      type: z.enum([
        "text",
        "textarea",
        "number",
        "email",
        "url",
        "phone",
        "select",
        "radio",
        "checkbox",
        "date",
      ]),
      required: z.boolean(),
      defaultValue: z.string().optional().or(z.literal("")),
      options: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        })
      ),
      hasMany: z.boolean(),
      minLength: z.string(),
      maxLength: z.string(),
      minValue: z.string(),
      maxValue: z.string(),
      placeholder: z.string().optional().or(z.literal("")),
      description: z.string().optional().or(z.literal("")),
      isActive: z.boolean(),
    })
    .superRefine((data, ctx) => {
      // Answers before a round trip; the server decides. Edit mode is exempt
      // because the name is fixed once the field exists and is submitted back
      // unchanged — a stored name that predates the server guard would
      // otherwise fail here with no way to correct it from this form.
      if (
        mode === "create" &&
        RESERVED_FIELD_NAMES.has(data.name.toLowerCase())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This field name is reserved and cannot be used",
          path: ["name"],
        });
      }

      // Options required for select/radio types
      if (data.type === "select" || data.type === "radio") {
        const validOptions = data.options.filter(
          o => o.label.trim() && o.value.trim()
        );
        if (validOptions.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "At least one option with a label and value is required for this field type",
            path: ["options"],
          });
        }

        // Report every duplicated value at once — fixing one collision
        // must not reveal the next as a surprise on resubmit.
        const counts = new Map<string, number>();
        for (const opt of validOptions) {
          counts.set(opt.value, (counts.get(opt.value) ?? 0) + 1);
        }
        const duplicates = [...counts.entries()]
          .filter(([, count]) => count > 1)
          .map(([value]) => `"${value}"`);
        if (duplicates.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate option values: ${duplicates.join(", ")}`,
            path: ["options"],
          });
        }
      }

      // Bounds: blank means unconstrained; otherwise a number, and the pair
      // must not cross.
      const checkPair = (
        minRaw: string,
        maxRaw: string,
        minPath: keyof UserFieldFormValues,
        maxPath: keyof UserFieldFormValues,
        integer: boolean
      ) => {
        const check = (raw: string, path: keyof UserFieldFormValues) => {
          if (!raw.trim()) return null;
          const parsed = Number(raw);
          // maxLength has a floor of 1 (a zero-length maximum admits nothing
          // and the API refuses it); minLength's floor stays 0.
          const floor = path === "maxLength" ? 1 : 0;
          if (
            !Number.isFinite(parsed) ||
            (integer && !Number.isInteger(parsed)) ||
            (integer && parsed < floor)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: integer
                ? "Must be a whole number of characters"
                : "Must be a number",
              path: [path],
            });
            return null;
          }
          return parsed;
        };
        const minParsed = check(minRaw, minPath);
        const maxParsed = check(maxRaw, maxPath);
        if (minParsed != null && maxParsed != null && minParsed > maxParsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Minimum cannot exceed maximum",
            path: [minPath],
          });
        }
      };
      if (LENGTH_BOUND_TYPES.includes(data.type)) {
        checkPair(
          data.minLength,
          data.maxLength,
          "minLength",
          "maxLength",
          true
        );
      }
      if (data.type === "number") {
        checkPair(data.minValue, data.maxValue, "minValue", "maxValue", false);
      }
    });
}

// ============================================================
// Form Defaults
// ============================================================

export const DEFAULT_VALUES: UserFieldFormValues = {
  label: "",
  name: "",
  type: "text",
  required: false,
  defaultValue: "",
  options: [],
  hasMany: false,
  minLength: "",
  maxLength: "",
  minValue: "",
  maxValue: "",
  placeholder: "",
  description: "",
  isActive: true,
};
