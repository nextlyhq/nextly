/**
 * A template's declared variables: the shape a save accepts, and which part
 * of a declaration is the owner's to change.
 *
 * A declaration's `name`, `description` and `required` say what the
 * template's sender supplies; its `type`, `label`, `example` and `fields`
 * only shape the editor's test data. The owner's later presentation reaches
 * every copy of its template, overridden or not, and never counts as a
 * change: typing a declaration sends no site an update to review.
 *
 * @module domains/email/template-variables
 */
import { z } from "zod";

import type {
  EmailTemplateVariable,
  EmailTemplateVariableField,
  EmailTemplateVariableType,
} from "../../schemas/email-templates/types";

/** The kinds of value a declaration may name. */
export const TEMPLATE_VARIABLE_TYPES = [
  "text",
  "number",
  "date",
  "money",
  "link",
  "boolean",
  "list",
  "object",
] as const satisfies readonly EmailTemplateVariableType[];

/** The types whose declaration may carry `fields`. */
const WITH_FIELDS: ReadonlySet<string> = new Set(["list", "object"]);

function onlyWhereFieldsBelong(field: {
  type?: string;
  fields?: unknown[];
}): boolean {
  return field.fields === undefined || WITH_FIELDS.has(field.type ?? "text");
}

const fieldsMessage = {
  message: "Only a list or an object variable has fields.",
  path: ["fields"],
};

const fieldShape = {
  name: z.string().trim().min(1).max(200),
  // Optional, as a plugin may declare it: a stored declaration without one
  // still saves.
  description: z.string().max(1000).optional(),
  type: z.enum(TEMPLATE_VARIABLE_TYPES).optional(),
  label: z.string().max(200).optional(),
  example: z.unknown().optional(),
};

const fieldSchema: z.ZodType<EmailTemplateVariableField> = z.lazy(() =>
  z
    .object({
      ...fieldShape,
      fields: z.array(fieldSchema).max(100).optional(),
    })
    .refine(onlyWhereFieldsBelong, fieldsMessage)
);

/** One declared variable, as a save gives it. Unknown keys are dropped. */
export const templateVariableSchema = z
  .object({
    ...fieldShape,
    required: z.boolean().optional(),
    fields: z.array(fieldSchema).max(100).optional(),
  })
  .refine(onlyWhereFieldsBelong, fieldsMessage);

/** A template's declared variables, as a save gives them. */
export const templateVariablesSchema = z
  .array(templateVariableSchema)
  .max(500)
  .nullable();

/** The part of a declaration that is presentation, not the owner's to change. */
const PRESENTATION_KEYS = ["type", "label", "example", "fields"] as const;

/**
 * The declarations as compared with an owner's: each one's name,
 * description and whether it is required, so presentation alone is never a
 * change. Anything that is not a list of declarations is compared as it is.
 */
export function declarationSubstance(variables: unknown): unknown {
  if (!Array.isArray(variables)) return variables ?? null;
  return variables.map((variable: unknown) => {
    if (!variable || typeof variable !== "object") return variable;
    const rest: Record<string, unknown> = {
      ...(variable as Record<string, unknown>),
    };
    for (const key of PRESENTATION_KEYS) delete rest[key];
    return rest;
  });
}

/**
 * The site's declarations with the owner's current presentation on each one
 * the owner also declares, by name. What the site says about a variable
 * stays the site's; a presentation field the owner leaves out stays the
 * site's too.
 */
export function withOwnerPresentation(
  site: EmailTemplateVariable[] | null,
  owner: readonly EmailTemplateVariable[] | null | undefined
): EmailTemplateVariable[] | null {
  if (!Array.isArray(site) || !owner?.length) return site;
  const owners = new Map(owner.map(variable => [variable.name, variable]));
  return site.map(variable => {
    const declared = owners.get(variable.name);
    if (!declared) return variable;
    const presentation: Partial<EmailTemplateVariable> = {};
    for (const key of PRESENTATION_KEYS) {
      if (declared[key] !== undefined) {
        (presentation as Record<string, unknown>)[key] = declared[key];
      }
    }
    return { ...variable, ...presentation };
  });
}
