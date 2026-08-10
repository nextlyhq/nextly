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
      const maxLength = field.constraints?.maxLength;

      // One `superRefine` rather than chained `.min`/`.max` inside a union.
      // A union whose members both fail reports its own generic "Invalid
      // input" and throws away the message naming the field, which is the
      // whole value of validating on the client.
      return z.string().superRefine((value, ctx) => {
        // A credential's stored value arrives as the server's eight-character
        // mask. That is not the credential and need not satisfy its rules: a
        // four-character PIN would otherwise be unopenable, because the mask
        // fails the provider's own `maxLength` and the provider could not be
        // renamed or deactivated without replacing a secret nobody wanted to
        // change.
        if (field.secret === true && isMaskedSecret(value)) return;

        if (value === "") {
          if (required) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required`,
            });
          }
          return;
        }

        if (maxLength !== undefined && value.length > maxLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field.label} must be at most ${maxLength} characters`,
          });
        }
      });
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
 * Segments that must never be walked or written.
 *
 * A field name is an arbitrary string chosen by whoever wrote the provider, and
 * these three reach `Object.prototype` rather than a property of the
 * configuration. Writing through one corrupts every plain object in the admin,
 * and merely opening the form is enough to do it — no save required.
 *
 * Core refuses these at registration, so a descriptor reaching this file should
 * never contain one. The check is here anyway because this code parses a
 * response: an older server, or anything else answering that endpoint, is not
 * bound by a rule added to the current one.
 */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Split a descriptor field name into path segments, or reject it.
 *
 * Returns `null` for a name that cannot be walked safely. Callers skip those
 * fields entirely: a field whose path is unsafe cannot be rendered, stored or
 * read back, so dropping it is the only honest outcome.
 */
function splitFieldPath(name: string): string[] | null {
  const segments = name.split(".");
  if (segments.some(part => part === "" || UNSAFE_PATH_SEGMENTS.has(part))) {
    return null;
  }
  return segments;
}

/** Read an own property, never one inherited from a prototype. */
function ownProperty(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : undefined;
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
  const existing = ownProperty(tree, head);
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
    const path = splitFieldPath(field.name);
    if (path === null) continue;
    assignAtPath(tree, path, fieldSchema(field));
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
    current = ownProperty(current as Record<string, unknown>, segment);
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
  const existing = ownProperty(config, head);
  const branch: Record<string, unknown> =
    existing !== null && existing !== undefined && typeof existing === "object"
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
    const path = splitFieldPath(field.name);
    if (path === null) continue;
    writeAtPath(configuration, path, initialFieldValue(field));
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
    const path = splitFieldPath(field.name);
    if (path === null) continue;
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

/** Remove a value at a dotted path, pruning any branch it leaves empty. */
function deleteAtPath(config: Record<string, unknown>, path: string[]): void {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    delete config[head];
    return;
  }
  const branch = ownProperty(config, head);
  if (branch === null || branch === undefined || typeof branch !== "object") {
    return;
  }
  const nested = branch as Record<string, unknown>;
  deleteAtPath(nested, rest);
  // An emptied branch is dropped rather than sent as `{}`: the server merges
  // what it receives, and a bare object says nothing the omission does not.
  if (Object.keys(nested).length === 0) delete config[head];
}

/**
 * Drop the credentials the user did not touch.
 *
 * Decided by two facts and no pattern: the DESCRIPTOR says which fields are
 * credentials, and the value the server sent for that field says what
 * "untouched" looks like for it. A field is omitted only when both agree.
 *
 * The pattern this replaces — treating any run of bullets or asterisks as a
 * mask — was wrong in two directions at once. It stripped a NON-secret field
 * whose value happened to look like one, silently discarding real
 * configuration; and it stripped a credential the user had deliberately typed
 * out of those characters, so a create failed as though the field were blank
 * and an update reported success while keeping the old secret.
 *
 * Creating has no stored configuration to compare against, so nothing is
 * dropped: every value the user entered is theirs and is sent.
 */
function withoutUntouchedSecrets(
  configuration: Record<string, unknown>,
  descriptor?: EmailProviderDescriptor,
  stored?: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = structuredClone(configuration);
  if (!descriptor || !stored) return cleaned;

  for (const field of descriptor.configFields) {
    if (field.secret !== true) continue;
    const path = splitFieldPath(field.name);
    if (path === null) continue;
    const current = readAtPath(cleaned, path);
    const asStored = readAtPath(stored, path);
    // Identical to what the server sent for this credential, which is its
    // mask. Indistinguishable from a user who retyped that exact string, and
    // that is fine: for a masked field the two mean the same thing.
    if (typeof current === "string" && current === asStored) {
      deleteAtPath(cleaned, path);
    }
  }

  return cleaned;
}

/** The create/update payload these form values produce. */
export interface EmailProviderPayload {
  name: string;
  type: string;
  fromEmail: string;
  fromName: string | null;
  isDefault: boolean;
  isActive: boolean;
  configuration: Record<string, unknown>;
}

/**
 * The create/update payload for these form values.
 *
 * `descriptor` and `stored` are what make an untouched credential detectable;
 * without them every value is sent, which is correct for a create and for a
 * provider whose descriptor this server no longer publishes.
 */
export function formValuesToPayload(
  values: ProviderFormValues,
  descriptor?: EmailProviderDescriptor,
  stored?: Record<string, unknown>
): EmailProviderPayload {
  // Untouched credentials are dropped first, so a mask never reaches the
  // clear check and is never mistaken for an emptied field.
  const configuration = markClearedOptionalFields(
    withoutUntouchedSecrets(values.configuration ?? {}, descriptor, stored),
    descriptor,
    stored
  );

  return {
    name: values.name,
    type: values.type,
    fromEmail: values.fromEmail,
    fromName: values.fromName || null,
    isDefault: values.isDefault,
    isActive: values.isActive,
    configuration,
  };
}

/**
 * Say what an emptied optional field means, in the one way a patch can.
 *
 * A patch merged over stored configuration has two states on its own: absent
 * means "leave it" and a value means "set it". Emptying a field produces
 * neither — an empty string is a value the provider probably rejects, and
 * omitting it is read as "leave it", which is how an optional field became
 * permanent the moment it was first saved.
 *
 * So an emptied field says one of two things depending on whether there was
 * ever anything there:
 *
 * - **Stored, now empty** → `null`, the request to remove the key. The server
 *   deletes it, and the provider's own parser then sees an absent optional
 *   field, which is what "optional and unset" means to a parser written as
 *   `z.enum(options).optional()` or `z.string().min(1).optional()` — both of
 *   which reject an empty string.
 * - **Never stored, still empty** → omitted. Nothing happened.
 *
 * Applies to EVERY optional field, not only selects. A cleared number
 * serialises away to nothing, and a cleared optional credential would
 * otherwise be sent as `""` and refused — three shapes of one bug, and fixing
 * the one that was reported would have left the other two.
 *
 * A required field never reaches here empty: the generated schema stops it,
 * naming the field, which is a better answer than a silent omission.
 */
function markClearedOptionalFields(
  configuration: Record<string, unknown>,
  descriptor?: EmailProviderDescriptor,
  stored?: Record<string, unknown>
): Record<string, unknown> {
  if (!descriptor) return configuration;

  const cleaned = structuredClone(configuration);
  for (const field of descriptor.configFields) {
    // A switch always holds a value, so it can never be "cleared".
    if (field.required === true || field.kind === "boolean") continue;

    const path = splitFieldPath(field.name);
    if (path === null) continue;

    const current = readAtPath(cleaned, path);
    // `undefined` as well as `""`: an emptied number is normalised to absent
    // before it ever becomes a string, so it arrives here as neither.
    if (current !== "" && current !== undefined) continue;

    const hadValue =
      stored !== undefined && readAtPath(stored, path) !== undefined;
    if (hadValue) {
      writeAtPath(cleaned, path, null);
    } else {
      deleteAtPath(cleaned, path);
    }
  }
  return cleaned;
}
