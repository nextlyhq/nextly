/**
 * `ui-schema.json` manifest — Zod source of truth (spec §4.12).
 *
 * One schema drives every validation layer (IDE `$schema`, dev-server watcher,
 * CLI load, dev write API, migrate:check). Field `type` uses the codebase's
 * canonical `FieldType` tokens (the builder subset) so the manifest round-trips
 * through `getColumnDescriptor` with no translation — see `to-snapshot.ts`.
 *
 * NOTE (spec deviation): spec §4.12.2 lists `boolean`; the canonical token is
 * `checkbox`. We use the canonical names.
 *
 * @module schemas/_zod/ui-schema
 * @since v0.0.3-alpha (Plan D1)
 */
import { z } from "zod";

/**
 * Canonical field-type tokens supported in ui-schema.json. Mirrors the set
 * `field-column-descriptor.ts:classifyFieldKind` maps to a column, so the
 * manifest round-trips through `getColumnDescriptor` with no translation.
 */
export const UI_FIELD_TYPES = [
  // original v1 subset
  "text",
  "textarea",
  "richText",
  "number",
  "checkbox",
  "toggle",
  "date",
  "select",
  "relationship",
  "upload",
  // widened to the full canonical set
  "email",
  "password",
  "code",
  "radio",
  "repeater",
  "group",
  "component",
  "json",
  "chips",
] as const;

/** Field names the framework reserves (system columns). */
const RESERVED_FIELD_NAMES = new Set(["id", "created_at", "updated_at"]);

const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

const slug = z
  .string()
  .regex(SLUG_RE, "slug must match ^[a-z][a-z0-9_-]*$")
  .refine(s => !s.startsWith("_") && !s.startsWith("nextly_"), {
    message: "slug must not use a reserved prefix (_ or nextly_)",
  });

const selectOption = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  value: z.string().min(1),
});

const validation = z
  .object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minRows: z.number().optional(),
    maxRows: z.number().optional(),
    pattern: z.string().optional(),
    message: z.string().optional(),
  })
  .refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "validation.min must be <= validation.max",
  })
  .refine(
    v =>
      v.minLength === undefined ||
      v.maxLength === undefined ||
      v.minLength <= v.maxLength,
    { message: "validation.minLength must be <= validation.maxLength" }
  )
  .refine(
    v => {
      if (v.pattern === undefined) return true;
      try {
        new RegExp(v.pattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: "validation.pattern must be a valid regular expression" }
  );

const fieldAdmin = z
  .object({
    width: z.enum(["25%", "33%", "50%", "66%", "75%", "100%"]).optional(),
    position: z.literal("sidebar").optional(),
    readOnly: z.boolean().optional(),
    hidden: z.boolean().optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    hideGutter: z.boolean().optional(),
    allowCreate: z.boolean().optional(),
    // condition's operator union is broad and the runtime evaluator is
    // fail-open; store it permissively so nothing is lost.
    condition: z.record(z.string(), z.unknown()).optional(),
  })
  .partial();

// Recursive field shape: container types (repeater/group/component) carry
// nested `fields`, so `field` references itself via z.lazy. The explicit
// FieldNode type breaks the circular inference.
export type FieldNode = {
  name: string;
  type: (typeof UI_FIELD_TYPES)[number];
  label?: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  hasMany?: boolean;
  relationTo?: string | string[];
  options?: { id?: string; label: string; value: string }[];
  defaultValue?: unknown;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    minRows?: number;
    maxRows?: number;
    pattern?: string;
    message?: string;
  };
  admin?: {
    width?: string;
    position?: "sidebar";
    readOnly?: boolean;
    hidden?: boolean;
    description?: string;
    placeholder?: string;
    hideGutter?: boolean;
    allowCreate?: boolean;
    condition?: Record<string, unknown>;
  };
  maxDepth?: number;
  allowCreate?: boolean;
  allowEdit?: boolean;
  isSortable?: boolean;
  relationshipFilter?: { field: string; equals: string };
  mimeTypes?: string;
  maxFileSize?: number;
  labels?: { singular?: string; plural?: string };
  initCollapsed?: boolean;
  rowLabelField?: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  fields?: FieldNode[];
};

const field: z.ZodType<FieldNode> = z.lazy(() =>
  z
    .object({
      name: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/, "field name must match ^[a-z][a-z0-9_]*$"),
      type: z.enum(UI_FIELD_TYPES),
      label: z.string().optional(),
      required: z.boolean().optional(),
      unique: z.boolean().optional(),
      index: z.boolean().optional(),
      hasMany: z.boolean().optional(),
      relationTo: z.union([z.string(), z.array(z.string())]).optional(),
      options: z.array(selectOption).optional(),
      defaultValue: z.unknown().optional(),
      validation: validation.optional(),
      admin: fieldAdmin.optional(),
      maxDepth: z.number().optional(),
      allowCreate: z.boolean().optional(),
      allowEdit: z.boolean().optional(),
      isSortable: z.boolean().optional(),
      relationshipFilter: z
        .object({ field: z.string(), equals: z.string() })
        .optional(),
      mimeTypes: z.string().optional(),
      maxFileSize: z.number().optional(),
      labels: z
        .object({
          singular: z.string().optional(),
          plural: z.string().optional(),
        })
        .optional(),
      initCollapsed: z.boolean().optional(),
      rowLabelField: z.string().optional(),
      component: z.string().optional(),
      components: z.array(z.string()).optional(),
      repeatable: z.boolean().optional(),
      // Nested fields for container types (repeater/group/component).
      fields: z.array(field).optional(),
    })
    .superRefine((f, ctx) => {
      if (
        (f.type === "select" || f.type === "radio") &&
        (!f.options || f.options.length === 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${f.type} fields require a non-empty options[] array`,
          path: ["options"],
        });
      }
      if (
        (f.type === "relationship" || f.type === "upload") &&
        (f.relationTo === undefined ||
          (typeof f.relationTo === "string" && f.relationTo.length === 0) ||
          (Array.isArray(f.relationTo) && f.relationTo.length === 0))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${f.type} fields require relationTo`,
          path: ["relationTo"],
        });
      }
      if (
        (f.type === "repeater" ||
          f.type === "group" ||
          f.type === "component") &&
        (!f.fields || f.fields.length === 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${f.type} fields require a non-empty fields[] array`,
          path: ["fields"],
        });
      }
      if (RESERVED_FIELD_NAMES.has(f.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field name '${f.name}' is reserved`,
          path: ["name"],
        });
      }
      if (f.defaultValue !== undefined) {
        const dv = f.defaultValue;
        const okType =
          (f.type === "number" && typeof dv === "number") ||
          ((f.type === "checkbox" || f.type === "toggle") &&
            typeof dv === "boolean") ||
          ([
            "text",
            "textarea",
            "richText",
            "email",
            "password",
            "code",
            "date",
            "select",
            "radio",
          ].includes(f.type) &&
            typeof dv === "string");
        if (!okType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `defaultValue type does not match field type '${f.type}'`,
            path: ["defaultValue"],
          });
        }
      }
    })
);

const admin = z.object({
  useAsTitle: z.string().optional(),
  defaultColumns: z.array(z.string()).optional(),
  group: z.string().optional(),
});

function entity() {
  return z
    .object({
      slug,
      labels: z.object({ singular: z.string(), plural: z.string() }).optional(),
      admin: admin.optional(),
      status: z.boolean().optional(),
      fields: z.array(field),
    })
    .superRefine((e, ctx) => {
      // Duplicate field names.
      const seen = new Set<string>();
      for (const f of e.fields) {
        if (seen.has(f.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate field name '${f.name}'`,
            path: ["fields"],
          });
        }
        seen.add(f.name);
      }
      // `status` reserved as a field name only when the lifecycle column is on.
      if (e.status === true && e.fields.some(f => f.name === "status")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "'status' is reserved when status: true",
          path: ["fields"],
        });
      }
      // admin references must point at real fields.
      const names = new Set(e.fields.map(f => f.name));
      if (e.admin?.useAsTitle && !names.has(e.admin.useAsTitle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `admin.useAsTitle references unknown field '${e.admin.useAsTitle}'`,
          path: ["admin", "useAsTitle"],
        });
      }
      for (const col of e.admin?.defaultColumns ?? []) {
        if (!names.has(col)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `admin.defaultColumns references unknown field '${col}'`,
            path: ["admin", "defaultColumns"],
          });
        }
      }
    });
}

function uniqueSlugs(
  entities: { slug: string }[],
  ctx: z.RefinementCtx,
  key: string
) {
  const seen = new Set<string>();
  for (const e of entities) {
    if (seen.has(e.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate slug '${e.slug}' in ${key}`,
        path: [key],
      });
    }
    seen.add(e.slug);
  }
}

export const uiSchemaManifest = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1).default(1),
    collections: z.array(entity()).default([]),
    singles: z.array(entity()).default([]),
    components: z.array(entity()).default([]),
  })
  .superRefine((m, ctx) => {
    uniqueSlugs(m.collections, ctx, "collections");
    uniqueSlugs(m.singles, ctx, "singles");
    uniqueSlugs(m.components, ctx, "components");
  });

export type UiSchemaManifest = z.infer<typeof uiSchemaManifest>;
export type UiSchemaEntity = UiSchemaManifest["collections"][number];
export type UiSchemaField = UiSchemaEntity["fields"][number];

/** Parse without throwing. Layers decide how to surface `!success`. */
export function parseUiSchema(input: unknown) {
  return uiSchemaManifest.safeParse(input);
}

/** JSON-schema document for the `$schema` URL (auto-generated from Zod). */
export function uiSchemaJsonSchema(): unknown {
  return z.toJSONSchema(uiSchemaManifest);
}
