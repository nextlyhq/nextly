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
function fieldSchema(
  field: EmailProviderConfigField,
  /**
   * What this field currently holds in the database, when it holds anything.
   *
   * A select validates against the options the descriptor offers TODAY, and a
   * provider upgrade may rename or drop one while its own parser still accepts
   * the stored string. Without this, such a provider cannot be renamed or
   * deactivated without first replacing configuration that is still valid — the
   * form refuses a value the operator never chose and cannot see.
   */
  storedValue?: unknown
): z.ZodTypeAny {
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
        field,
        storedValue
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
      // Optional means the KEY may be absent, matching the number branch. A
      // stored value the control cannot show is left out of the form entirely,
      // and a schema demanding the key would then refuse every unrelated edit
      // on the strength of a value nobody could see.
      const chosen = z.string().superRefine((value, ctx) => {
        if (value === "") {
          if (required) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required`,
            });
          }
          return;
        }
        // The value already in the database passes whatever the options say.
        // It is the provider's own stored configuration, and its parser is the
        // authority on whether it is still acceptable — the descriptor only
        // describes what a NEW choice may be.
        if (storedValue === value) return;

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
      return required ? chosen : chosen.optional();
    }

    case "text":
    case "password": {
      const maxLength = field.constraints?.maxLength;

      // One `superRefine` rather than chained `.min`/`.max` inside a union.
      // A union whose members both fail reports its own generic "Invalid
      // input" and throws away the message naming the field, which is the
      // whole value of validating on the client.
      const bounded = z.string().superRefine((value, ctx) => {
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

        // The value already in the database passes whatever the descriptor
        // now says. It is the provider's own stored configuration and its
        // parser is the authority on whether it is still acceptable — the
        // descriptor only describes what a REPLACEMENT may be. Without this, a
        // provider upgrade that lowers `maxLength` makes every stored value
        // longer than the new bound unrenameable and undeactivatable.
        //
        // The same exemption the select branch makes for a legacy choice.
        if (storedValue === value) return;

        if (maxLength !== undefined && value.length > maxLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field.label} must be at most ${maxLength} characters`,
          });
        }
      });
      return required ? bounded : bounded.optional();
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
  field: EmailProviderConfigField,
  /** What this field currently holds, exempt from bounds it predates. */
  storedValue?: unknown
): z.ZodTypeAny {
  const { min, max } = field.constraints ?? {};
  if (min === undefined && max === undefined) return base;

  // A refinement rather than `.min`/`.max`, because those reject before any
  // exemption can run — and a stored value has to survive a bound tightened
  // after it was written, exactly as a stored string and a legacy select
  // choice do. The provider's own parser stays the authority on what is
  // acceptable; the descriptor describes what a REPLACEMENT may be.
  return base.superRefine((value, ctx) => {
    if (storedValue === value) return;

    if (min !== undefined && value < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field.label} must be at least ${min}`,
      });
    }
    if (max !== undefined && value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field.label} must be at most ${max}`,
      });
    }
  });
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
  const existing = ownProperty(tree, head);

  if (rest.length === 0) {
    // Something already stands here, so two declared paths claim one place --
    // `auth` beside `auth.pass`. Overwriting would discard whichever arrived
    // first, and which one that is depends only on the order the descriptor
    // happens to list them in. The first declaration keeps the place; the
    // conflicting one is skipped, exactly as an unwalkable name is.
    if (existing !== undefined) return;
    tree[head] = leaf;
    return;
  }

  // A leaf already claimed this name. `typeof aZodSchema === "object"` is
  // true, so treating it as a branch would write the nested field onto the
  // Zod instance itself -- mutating a schema object, and hanging the result
  // somewhere `toObjectSchema` never looks, so the nested field ends up with
  // no schema either way.
  if (existing instanceof z.ZodType) return;

  const branch: Record<string, unknown> =
    existing !== undefined && typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {};
  tree[head] = branch;
  assignAtPath(branch, rest, leaf);
}

/** Turn the nested plain tree of leaf schemas into nested `z.object`s. */
function toObjectSchema(tree: Record<string, unknown>): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(tree)) {
    shape[key] =
      value instanceof z.ZodType
        ? value
        : toObjectSchema(value as Record<string, unknown>);
  }

  const built = z.object(shape);

  // A branch that holds nothing required is itself not required. Field paths
  // are dotted, so `auth.user` and `auth.pass` conjure an `auth` object that
  // no descriptor declared -- and a stored value one of its controls cannot
  // show is left out of the form, taking the whole branch with it. Demanding
  // the parent would then refuse an unrelated edit with a missing-`auth`
  // error, naming a key the operator has never seen.
  //
  // Decided by asking the schema rather than by inspecting its members: if it
  // accepts an empty object, nothing inside it was required.
  return built.safeParse({}).success ? built.optional() : built;
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
  descriptor: EmailProviderDescriptor | undefined,
  stored?: Record<string, unknown>
): z.ZodType<Record<string, unknown>, Record<string, unknown>> {
  // No descriptor means the provider is not registered on this server. The form
  // renders read-only in that state, so validating its configuration would only
  // produce errors about fields nobody can edit.
  if (!descriptor) return z.record(z.string(), z.unknown());

  const tree: Record<string, unknown> = {};
  for (const field of descriptor.configFields) {
    const path = splitFieldPath(field.name);
    if (path === null) continue;
    // Normalised through the same function the form hydrates through, so the
    // schema compares against the representation the form actually holds. A
    // provider whose parser coerces can have stored a number where its select
    // now offers strings; hydration carries that in as `"1"` while the raw
    // stored value is `1`, and an identity comparison between them says the
    // legacy choice is a different value than the one on screen — which
    // rejects a field nobody touched and makes the whole form unsubmittable.
    const leaf = fieldSchema(
      field,
      stored === undefined
        ? undefined
        : storedValueForControl(field, readAtPath(stored, path))
    );

    // A stored value the control cannot show is left out of the form, and the
    // patch then says "leave this alone" by omitting it. A required field
    // would otherwise be demanded of a form that deliberately does not hold
    // it, so an operator who opened the page to rename the provider is
    // refused over a field they cannot see, cannot correct, and were never
    // asked to change.
    //
    // Asked of the same predicate the fields render their notice from, so the
    // form, the payload and the schema cannot come to disagree about which
    // values are showable.
    assignAtPath(
      tree,
      path,
      hasUnrepresentableStoredValue(stored, field) ? leaf.optional() : leaf
    );
  }

  // The top level is always present -- the form holds a `configuration` object
  // whatever is in it -- so the optionality the helper adds for empty branches
  // is not wanted here.
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
 * The whole form's schema for the currently selected provider.
 *
 * Rebuilt when the selected type changes, because the configuration half of it
 * is that provider's and nothing else's.
 */
export function buildProviderSchema(
  descriptor?: EmailProviderDescriptor,
  /** The stored configuration, so a legacy select choice stays valid. */
  stored?: Record<string, unknown>
) {
  return z.object({
    ...identitySchema,
    configuration: configurationSchema(descriptor, stored),
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

/**
 * Controls whose value is a string, both in the input and in the schema built
 * for it. A select belongs here as much as a text field does: its options are
 * declared as strings and it matches the current value against them.
 */
const STRING_BACKED_KINDS: ReadonlyArray<EmailProviderConfigField["kind"]> = [
  "text",
  "password",
  "select",
];

/**
 * A stored value in the runtime type its control renders.
 *
 * The server validates the PARSED configuration and stores the object it was
 * given, so a provider whose parser coerces — `z.coerce.number()` accepts
 * `"3"` from a REST or Direct API caller — leaves a string under a field the
 * descriptor declares as a number. `ProviderConfigFields` renders a number
 * input only for a value whose runtime type is `number`, so the stored value
 * would appear as a blank field: the operator sees a valid setting missing,
 * and a save either unsets it or is blocked.
 *
 * It runs in both directions, because coercion does. A parser written as
 * `z.coerce.string()` accepts `1` and the number is what gets stored, under a
 * field the descriptor declares as text or select — where a select compares
 * its option values by identity and shows as unselected, and the generated
 * schema is `z.string()`, so every unrelated edit is refused until the
 * operator re-picks a value they already chose.
 *
 * Only a scalar is converted. A number a `maxLength` cannot describe stays as
 * it is on a number control, while an object or an array under a STRING
 * control is dropped rather than stringified -- "[object Object]" is not what
 * is stored, and offering it back as a value to save is worse than showing
 * nothing.
 *
 * A boolean control gets neither treatment. `z.coerce.boolean()` is a
 * truthiness conversion, under which a stored `"false"` is TRUE while every
 * reading of the characters says otherwise, so no mapping here can be right
 * for certain and a wrong one writes the opposite of what is stored. The value
 * is dropped instead: an absent key is how a patch says "leave this alone",
 * which is the one answer that is correct whichever way the provider's parser
 * reads it. `ProviderConfigFields` says so on the field, so the switch's
 * position is not mistaken for the stored setting.
 */
function storedValueForControl(
  field: EmailProviderConfigField,
  value: unknown
): unknown {
  if (field.kind === "number") {
    if (typeof value === "number")
      return Number.isFinite(value) ? value : undefined;
    // A string is the ordinary coerced form and converts when it can. Anything
    // else -- a boolean, an array, an object -- is a value `z.coerce.number()`
    // accepts and this control cannot show, so it is dropped rather than
    // carried: the input renders blank either way, and carrying it makes the
    // generated `z.number()` refuse every unrelated edit.
    if (typeof value !== "string") return undefined;
    const asNumber = Number(value);
    return value.trim() !== "" && Number.isFinite(asNumber)
      ? asNumber
      : undefined;
  }

  if (field.kind === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (!STRING_BACKED_KINDS.includes(field.kind)) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : value;
  }
  if (typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") return value;
  // An object, an array, or a non-finite number: a control that renders a
  // string has no way to show it, and stringifying one offers "[object
  // Object]" back as a value to save. Dropped for the same reason a
  // non-boolean is dropped from a switch -- an absent key leaves the stored
  // value alone, which is the only answer that cannot be wrong.
  return undefined;
}

/**
 * What an EDIT shows for a field the stored configuration does not have.
 *
 * Blank, not the descriptor's default. A default is what to PRE-FILL when
 * adding a provider; on an edit it would put a value the operator never chose
 * into a form they opened to rename something, and the save would persist it —
 * replacing an absence the provider's own parser may have been handling with
 * its own fallback.
 *
 * A boolean is the exception, and only because it has no blank: a switch has to
 * render in one position, so it takes the declared default, which registration
 * now requires for every optional boolean precisely so this is never a guess.
 */
function hydratedFieldValue(field: EmailProviderConfigField): unknown {
  return field.kind === "boolean" ? initialFieldValue(field) : "";
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
    if (value === undefined) {
      writeAtPath(configuration, path, hydratedFieldValue(field));
      continue;
    }

    const forControl = storedValueForControl(field, value);
    // A stored value the control cannot represent is left out of the form
    // entirely rather than replaced by a stand-in. The key is then absent from
    // the patch, which is how "leave this alone" is spelled — the same thing a
    // masked credential achieves by round-tripping its mask.
    if (forControl === undefined) continue;
    writeAtPath(configuration, path, forControl);
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
    const path = splitFieldPath(field.name);
    if (path === null) continue;
    const current = readAtPath(cleaned, path);
    const asStored = readAtPath(stored, path);
    if (typeof current !== "string" || current !== asStored) continue;

    // Identical to what the server sent for this credential, which is its
    // mask. Indistinguishable from a user who retyped that exact string, and
    // that is fine: for a masked field the two mean the same thing.
    //
    // Also dropped when the value merely LOOKS like a mask, whatever the
    // descriptor says the field is. A form stays open across a deployment,
    // and a field that was `secret` when the values were hydrated can be
    // described as public by the time they are submitted — the mask is then
    // no longer recognised as one and is written back as though it were the
    // credential, replacing the stored one with eight bullet characters.
    // Deciding from the value that is actually in hand cannot be overtaken
    // that way, and it costs nothing where the field really does hold
    // bullets: the value is unchanged, so omitting it and sending it leave
    // the same thing stored.
    if (field.secret === true || isMaskedSecret(asStored)) {
      deleteAtPath(cleaned, path);
    }
  }

  return cleaned;
}

/**
 * Did the SERVER send a mask for this field — that is, does a stored
 * credential exist behind it?
 *
 * Provenance, which the field's own value cannot supply. A credential that
 * happens to be typed as `••••` is character-identical to the mask, so a field
 * inferring "this came from storage" from its contents would clear a password
 * the user just entered the moment they pressed reveal. The stored record
 * answers it instead, and it is the only thing that can.
 */
export function hasStoredSecret(
  stored: Record<string, unknown> | undefined,
  fieldName: string
): boolean {
  if (stored === undefined) return false;
  const path = splitFieldPath(fieldName);
  if (path === null) return false;
  return isMaskedSecret(readAtPath(stored, path));
}

/**
 * Whether a switch is showing a position its stored value did not choose.
 *
 * A value the control cannot show is left out of the form, so the control
 * renders its empty state regardless of what is stored: a switch reads off, a
 * text input reads blank. Saying so is the difference between a control the
 * operator can read and one that quietly misreports.
 *
 * Covers a boolean holding a non-boolean, which cannot be hydrated without
 * guessing, and an object or array under a string control, which has no
 * rendering at all.
 */
export function hasUnrepresentableStoredValue(
  stored: Record<string, unknown> | undefined,
  field: EmailProviderConfigField
): boolean {
  if (stored === undefined) return false;
  const path = splitFieldPath(field.name);
  if (path === null) return false;
  const value = readAtPath(stored, path);
  if (value === undefined) return false;
  // Asked of the same function the form hydrates through, so the notice and
  // the omission cannot come to disagree about which values are showable.
  return storedValueForControl(field, value) === undefined;
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
  /**
   * Configuration fields this submission CLEARS, by declared name.
   *
   * Beside the values rather than inside them. Any marker placed in
   * `configuration` itself — `null`, `""`, a sentinel string — is a value some
   * provider's parser legitimately accepts, so a create would store it while
   * an update read the identical request as a deletion. Absent on a create,
   * where there is nothing to clear.
   */
  unsetConfiguration?: string[];
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
  // Clearing is decided from what the user is LOOKING AT, before untouched
  // credentials are dropped. An untouched credential holds the server's mask,
  // which is plainly not empty; dropping it first removes it from the values
  // and the clear check then sees an absent field with something stored behind
  // it — the exact shape of a deliberate removal. Ordered the other way, an
  // edit that only renames a provider deletes its password.
  const { configuration: kept, unsetConfiguration } =
    separateClearedOptionalFields(
      values.configuration ?? {},
      descriptor,
      stored
    );

  // Now the masks go, which is how "leave this credential alone" is spelled on
  // the wire: the server merges what remains over what it holds.
  const configuration = withoutUntouchedSecrets(kept, descriptor, stored);

  return {
    name: values.name,
    type: values.type,
    fromEmail: values.fromEmail,
    fromName: values.fromName || null,
    isDefault: values.isDefault,
    isActive: values.isActive,
    configuration,
    ...(unsetConfiguration.length > 0 ? { unsetConfiguration } : {}),
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
 * - **Stored, now empty** → named in `unsetConfiguration`, the request to
 *   remove the key, and omitted from `configuration`. The server deletes it,
 *   and the provider's own parser then sees an absent optional field, which is
 *   what "optional and unset" means to a parser written as
 *   `z.enum(options).optional()` or `z.string().min(1).optional()` — both of
 *   which reject an empty string.
 * - **Never stored, still empty** → omitted entirely. Nothing happened.
 *
 * The removal travels beside the configuration rather than inside it because
 * every in-band marker is a value some provider legitimately stores: `null`
 * and `""` are both accepted by nullable parsers, and a create writes them
 * verbatim. Only a separate list can mean "remove" and nothing else.
 *
 * Applies to EVERY optional field, not only selects. A cleared number
 * serialises away to nothing, and a cleared optional credential would
 * otherwise be sent as `""` and refused — three shapes of one bug, and fixing
 * the one that was reported would have left the other two.
 *
 * A required field never reaches here empty: the generated schema stops it,
 * naming the field, which is a better answer than a silent omission.
 */
function separateClearedOptionalFields(
  configuration: Record<string, unknown>,
  descriptor?: EmailProviderDescriptor,
  stored?: Record<string, unknown>
): { configuration: Record<string, unknown>; unsetConfiguration: string[] } {
  if (!descriptor) return { configuration, unsetConfiguration: [] };

  const cleaned = structuredClone(configuration);
  const unsetConfiguration: string[] = [];

  for (const field of descriptor.configFields) {
    // A switch always holds a value, so it can never be "cleared".
    if (field.required === true || field.kind === "boolean") continue;
    // The provider says a blank means an empty string here, not an absent key.
    // Its parser demands the key exist — SMTP's `auth.user` and `auth.pass`
    // live inside a required object — so removing it would break exactly the
    // configuration the field was declared optional to allow.
    if (field.blankAs === "empty") continue;

    const path = splitFieldPath(field.name);
    if (path === null) continue;

    const current = readAtPath(cleaned, path);
    // `undefined` as well as `""`: an emptied number is normalised to absent
    // before it ever becomes a string, so it arrives here as neither.
    if (current !== "" && current !== undefined) continue;

    // ABSENT because the control could not show what is stored, not because
    // anyone emptied it. Hydration leaves such a field out of the form, and
    // reading that as a removal would delete the very value it was protecting
    // — the operator never saw it, let alone cleared it. Left out of the patch
    // entirely: no value to set, and nothing to unset.
    //
    // Only for `undefined`. An explicit `""` is a value the operator produced:
    // they typed a replacement into the blank control and then deleted it,
    // which is a removal like any other. Skipping that too would make such a
    // field permanently unclearable, which is the opposite failure and just as
    // silent.
    if (current === undefined && hasUnrepresentableStoredValue(stored, field)) {
      continue;
    }

    // Removed from the values either way. What differs is whether the server
    // is also asked to delete what it holds — the field name is sent only
    // when there is something stored to remove.
    deleteAtPath(cleaned, path);

    const hadValue =
      stored !== undefined && readAtPath(stored, path) !== undefined;
    if (hadValue) unsetConfiguration.push(field.name);
  }

  return { configuration: cleaned, unsetConfiguration };
}
