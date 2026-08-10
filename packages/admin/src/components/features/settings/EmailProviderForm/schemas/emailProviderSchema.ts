/**
 * Form values and validation for the email provider form, derived from the
 * server's provider descriptors.
 *
 * Nothing here names a provider. The fields, their controls, their bounds and
 * which of them are credentials all arrive from the registry, so adding a
 * provider is a server-side act and this file never changes for it.
 *
 * The client schema is GENERATED from the same descriptor the form renders, so
 * the form and its validation cannot drift apart. `parseConfig` on the server
 * stays authoritative, and the descriptor carries only four hints (`required`,
 * `min`, `max`, `maxLength`) — enough for immediate feedback, too little to
 * restate a rule.
 *
 * Those four are absolute, so a provider whose real rule is CONDITIONAL cannot
 * express it here and has to state the stricter half. SMTP is the live example:
 * its credentials are required for a remote server and optional for a loopback
 * sink, the descriptor can only say `required`, and the form therefore asks for
 * a username and password even where the server would have accepted neither.
 */

import { z } from "zod";

import type {
  EmailProviderConfigField,
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

/**
 * What the server sends back in place of a stored credential.
 *
 * Read as "unchanged" on the way out: the server strips this value before
 * merging an update, so echoing it back leaves the stored secret alone.
 */
export const MASKED_SECRET = "••••••••";

/**
 * Does this value stand for a credential the user has not touched?
 *
 * Matches the mask this admin renders and the rows of asterisks older records
 * were masked with, so a provider stored before the current mask still reads as
 * untouched rather than as a password of eight literal stars.
 */
export function isMaskedSecret(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === MASKED_SECRET || /^[*•]+$/.test(value))
  );
}

// ============================================================
// Form values
// ============================================================

/**
 * The form's value shape.
 *
 * `configuration` is nested exactly as the API stores it. React Hook Form
 * builds that nesting from the dotted field paths the descriptors declare
 * (`auth.pass` registers as `configuration.auth.pass`), which is why no code
 * here assembles provider-specific objects.
 */
export interface ProviderFormValues {
  name: string;
  type: string;
  fromEmail: string;
  fromName: string;
  isDefault: boolean;
  isActive: boolean;
  configuration: Record<string, unknown>;
}

// ============================================================
// Schema
// ============================================================

/** The provider-independent half. Identical for every provider type. */
const identitySchema = {
  name: z.string().min(1, "Provider name is required").max(255),
  type: z.string().min(1, "Select a provider type"),
  fromEmail: z.string().email("Please enter a valid email address"),
  // Optional by being allowed to be empty rather than by being absent: the
  // form always holds a string for it, and an `optional()` here would make the
  // schema's own value type disagree with the form's.
  fromName: z.string().max(255),
  isDefault: z.boolean(),
  isActive: z.boolean(),
};

/**
 * The validator for one descriptor field.
 *
 * The switch over `kind` is exhaustive against a closed union, so a new control
 * kind is a compile error here rather than a field that silently validates as
 * anything.
 */
function fieldSchema(field: EmailProviderConfigField): z.ZodTypeAny {
  const required = field.required === true;

  switch (field.kind) {
    case "number": {
      // A number input hands back a string, and an empty one hands back NaN.
      // Both are normalised BEFORE validation so an empty field reports itself
      // as missing rather than as the number zero, which `z.coerce` would
      // quietly produce and a bound-free field would then accept.
      const bounded = applyNumericBounds(
        z.number({
          // Missing and unparsable are different failures with different
          // fixes, so the message names the right one. `input` is what
          // survived normalisation: absent for an empty field, the original
          // string for something that is not a number at all.
          error: issue =>
            issue.input === undefined
              ? `${field.label} is required`
              : `${field.label} must be a number`,
        }),
        field
      );
      return z.preprocess(
        toNumberOrAbsent,
        required ? bounded : bounded.optional()
      );
    }

    case "boolean":
      // A switch always has a value, so `required` adds nothing to enforce.
      return z.boolean().optional();

    case "select": {
      const values = (field.options ?? []).map(option => option.value);
      return z.string().superRefine((value, ctx) => {
        if (value === "") {
          if (required) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required`,
            });
          }
          return;
        }
        // An empty option list means the provider declared a select without
        // choices; nothing can be checked against, so any value passes and the
        // server's parser has the final say.
        if (values.length > 0 && !values.includes(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Select a valid ${field.label.toLowerCase()}`,
          });
        }
      });
    }

    case "text":
    case "password": {
      let base = z.string();
      if (field.constraints?.maxLength !== undefined) {
        base = base.max(
          field.constraints.maxLength,
          `${field.label} must be at most ${field.constraints.maxLength} characters`
        );
      }
      return required
        ? base.min(1, `${field.label} is required`)
        : base.optional().or(z.literal(""));
    }
  }
}

/**
 * Normalise a numeric input before it is validated.
 *
 * An unparsable string is returned UNCHANGED rather than as `undefined`, so it
 * reports "must be a number" instead of "is required" — the two failures have
 * different fixes and the message has to name the right one.
 */
function toNumberOrAbsent(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

/** Apply the descriptor's numeric bounds, naming the field in each message. */
function applyNumericBounds(
  base: z.ZodNumber,
  field: EmailProviderConfigField
): z.ZodNumber {
  let schema = base;
  const { min, max } = field.constraints ?? {};
  if (min !== undefined) {
    schema = schema.min(min, `${field.label} must be at least ${min}`);
  }
  if (max !== undefined) {
    schema = schema.max(max, `${field.label} must be at most ${max}`);
  }
  return schema;
}

/**
 * Nest a leaf schema at a dotted path.
 *
 * `auth.pass` has to produce `{ auth: { pass } }`, because that is the shape
 * the provider's own parser expects. A flat `{"auth.pass": …}` posts happily
 * and is rejected server-side against a path that looks correct, which is the
 * least legible way this could fail.
 */
function assignAtPath(
  tree: Record<string, unknown>,
  path: string[],
  leaf: z.ZodTypeAny
): void {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    tree[head] = leaf;
    return;
  }
  const existing = tree[head];
  const branch: Record<string, unknown> =
    existing !== undefined && typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {};
  tree[head] = branch;
  assignAtPath(branch, rest, leaf);
}

/** Turn the nested plain tree of leaf schemas into nested `z.object`s. */
function toObjectSchema(
  tree: Record<string, unknown>
): z.ZodType<Record<string, unknown>, Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(tree)) {
    shape[key] =
      value instanceof z.ZodType
        ? value
        : toObjectSchema(value as Record<string, unknown>);
  }
  return z.object(shape);
}

/**
 * Build the `configuration` schema for one provider.
 *
 * A secret the user has not touched arrives as the mask, which is a non-empty
 * string and so satisfies a required field without special-casing. Clearing it
 * deliberately leaves an empty value, and that IS reported — a provider whose
 * credential is required cannot work without one, and saying so here is kinder
 * than a round trip that fails on the server.
 */
function configurationSchema(
  descriptor: EmailProviderDescriptor | undefined
): z.ZodType<Record<string, unknown>, Record<string, unknown>> {
  // No descriptor means the provider is not registered on this server. The form
  // renders read-only in that state, so validating its configuration would only
  // produce errors about fields nobody can edit.
  if (!descriptor) return z.record(z.string(), z.unknown());

  const tree: Record<string, unknown> = {};
  for (const field of descriptor.configFields) {
    assignAtPath(tree, field.name.split("."), fieldSchema(field));
  }
  return toObjectSchema(tree);
}

/**
 * The whole form's schema for the currently selected provider.
 *
 * Rebuilt when the selected type changes, because the configuration half of it
 * is that provider's and nothing else's.
 */
export function buildProviderSchema(descriptor?: EmailProviderDescriptor) {
  return z.object({
    ...identitySchema,
    configuration: configurationSchema(descriptor),
  });
}

// ============================================================
// Values in and out
// ============================================================

/** Read a dotted path out of a nested configuration object. */
function readAtPath(config: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = config;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Write a value at a dotted path, creating the branches it needs. */
function writeAtPath(
  config: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    config[head] = value;
    return;
  }
  const existing = config[head];
  const branch: Record<string, unknown> =
    existing !== null && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {};
  config[head] = branch;
  writeAtPath(branch, rest, value);
}

/**
 * The value a field starts at when a provider of this type is added.
 *
 * A secret never carries a default — the server strips one from the descriptor
 * before sending it — so this only pre-fills the harmless half.
 */
function initialFieldValue(field: EmailProviderConfigField): unknown {
  if (field.default !== undefined) return field.default;
  return field.kind === "boolean" ? false : "";
}

/** A blank configuration for a provider type, from its descriptor. */
export function emptyConfiguration(
  descriptor?: EmailProviderDescriptor
): Record<string, unknown> {
  const configuration: Record<string, unknown> = {};
  for (const field of descriptor?.configFields ?? []) {
    writeAtPath(configuration, field.name.split("."), initialFieldValue(field));
  }
  return configuration;
}

/** The form's starting values when adding a provider. */
export function defaultFormValues(
  descriptor?: EmailProviderDescriptor
): ProviderFormValues {
  return {
    name: "",
    type: descriptor?.type ?? "",
    fromEmail: "",
    fromName: "",
    isDefault: false,
    isActive: true,
    configuration: emptyConfiguration(descriptor),
  };
}

/**
 * Turn a stored provider into form values.
 *
 * Only the fields the descriptor declares are carried across: an unrecognised
 * key in the stored configuration belongs to a provider version this one no
 * longer matches, and rendering it would offer an edit nothing will read.
 * Values already stored are preferred over defaults, including a masked secret,
 * which is what makes "leave it alone" the natural outcome of not typing.
 */
export function providerToFormValues(
  provider: EmailProviderRecord,
  descriptor?: EmailProviderDescriptor
): ProviderFormValues {
  const stored = provider.configuration ?? {};
  const configuration: Record<string, unknown> = {};

  for (const field of descriptor?.configFields ?? []) {
    const path = field.name.split(".");
    const value = readAtPath(stored, path);
    writeAtPath(
      configuration,
      path,
      value === undefined ? initialFieldValue(field) : value
    );
  }

  return {
    name: provider.name,
    type: provider.type,
    fromEmail: provider.fromEmail,
    fromName: provider.fromName ?? "",
    isDefault: provider.isDefault,
    isActive: provider.isActive,
    configuration,
  };
}

/**
 * Drop the values the user did not touch.
 *
 * An untouched credential is the mask, and sending it back is harmless — the
 * server strips it before merging — but omitting it keeps the request honest
 * about what changed and keeps the mask out of request logs.
 */
function withoutMaskedSecrets(
  config: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isMaskedSecret(value)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = withoutMaskedSecrets(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/** The create/update payload for these form values. */
export function formValuesToPayload(values: ProviderFormValues) {
  return {
    name: values.name,
    type: values.type,
    fromEmail: values.fromEmail,
    fromName: values.fromName || null,
    isDefault: values.isDefault,
    isActive: values.isActive,
    configuration: withoutMaskedSecrets(values.configuration ?? {}),
  };
}
