/**
 * Shared validation for field payloads entering the schema surfaces.
 *
 * Every writer of collection/single/component field definitions — the
 * dispatcher preview/apply methods and the standalone schema routes —
 * validates with the SAME rules that gate the `ui-schema.json` mirror
 * (`uiSchemaFieldSchema`). One validator for both writers is what keeps
 * the DB and the committed manifest from ever disagreeing about what a
 * legal field is: a payload that applied to the DB but failed the mirror
 * write would silently diverge the git-facing schema from the database.
 *
 * Validation-only by design: the original payload is persisted, not the
 * parsed copy, so builder-specific passthrough keys survive untouched.
 */
import { z } from "zod";

import { uiSchemaFieldSchema } from "../schemas/_zod/ui-schema";

import { nextlyValidationFromZod } from "./zod-to-nextly-error";

// The ui-schema.json entity validator rejects duplicate field names, so the
// shared payload validator must too — otherwise a payload could pass the
// API/dispatcher checks and still fail the manifest write, exactly the
// divergence this shared validator exists to prevent.
const fieldsArraySchema = z
  .array(uiSchemaFieldSchema)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      const name = (field as { name?: unknown }).name;
      if (typeof name !== "string") return;
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate field name '${name}'`,
          path: [index, "name"],
        });
      }
      seen.add(name);
    });
  });

/**
 * Throw `NextlyError.validation` (with per-field paths) unless `fields`
 * satisfies the manifest field rules.
 */
export function assertValidFieldsPayload(fields: unknown): void {
  const parsed = fieldsArraySchema.safeParse(fields);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }
}
