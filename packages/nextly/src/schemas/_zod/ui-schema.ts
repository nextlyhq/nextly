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

/** Builder-supported subset of the codebase `FieldType` tokens. */
export const UI_FIELD_TYPES = [
  "text",
  "textarea",
  "richText",
  "number",
  "checkbox",
  "date",
  "select",
  "relationship",
  "upload",
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
  label: z.string().min(1),
  value: z.string().min(1),
});

const validation = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
  })
  .refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "validation.min must be <= validation.max",
  })
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

const field = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "field name must match ^[a-z][a-z0-9_]*$"),
    type: z.enum(UI_FIELD_TYPES),
    required: z.boolean().optional(),
    hasMany: z.boolean().optional(),
    relationTo: z.string().optional(),
    options: z.array(selectOption).optional(),
    defaultValue: z.unknown().optional(),
    validation: validation.optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "select fields require a non-empty options[] array",
        path: ["options"],
      });
    }
    if (
      (f.type === "relationship" || f.type === "upload") &&
      (f.relationTo === undefined || f.relationTo.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${f.type} fields require relationTo`,
        path: ["relationTo"],
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
        (f.type === "checkbox" && typeof dv === "boolean") ||
        (["text", "textarea", "richText", "date", "select"].includes(f.type) &&
          typeof dv === "string");
      if (!okType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `defaultValue type does not match field type '${f.type}'`,
          path: ["defaultValue"],
        });
      }
    }
  });

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
