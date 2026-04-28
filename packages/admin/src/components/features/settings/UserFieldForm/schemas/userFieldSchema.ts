import * as z from "zod";

import type {
  UserFieldType,
  type UserFieldDefinitionRecord,
  type CreateUserFieldPayload,
  type UpdateUserFieldPayload} from "@admin/services/userFieldsApi";

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
  placeholder: string;
  description: string;
  isActive: boolean;
}

// ============================================================
// Constants
// ============================================================

/**
 * Reserved user field names matching the backend RESERVED_USER_FIELD_NAMES.
 * Compared case-insensitively.
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
    placeholder: field.placeholder ?? "",
    description: field.description ?? "",
    isActive: field.isActive,
  };
}

// ============================================================
// Zod Schema
// ============================================================

export function buildUserFieldSchema(mode: "create" | "edit") {
  return z
    .object({
      label: z.string().min(1, "Label is required").max(255),
      name: z
        .string()
        .min(1, "Field name is required")
        .max(64)
        .regex(
          /^[a-z][a-z0-9_]*$/,
          "Must start with a letter and contain only lowercase letters, numbers, and underscores"
        ),
      type: z.enum([
        "text",
        "textarea",
        "number",
        "email",
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
      placeholder: z.string().optional().or(z.literal("")),
      description: z.string().optional().or(z.literal("")),
      isActive: z.boolean(),
    })
    .superRefine((data, ctx) => {
      // Reserved name check (only in create mode since name is immutable in edit)
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

        // Check for duplicate option values
        const seen = new Set<string>();
        for (const opt of validOptions) {
          if (seen.has(opt.value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate option value: "${opt.value}"`,
              path: ["options"],
            });
            break;
          }
          seen.add(opt.value);
        }
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
  placeholder: "",
  description: "",
  isActive: true,
};
