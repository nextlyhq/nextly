/**
 * What a mail provider has to tell Nextly about itself.
 *
 * A provider used to be a `type` string plus a factory, which was enough to
 * dispatch a send and not enough for anything else: the REST layer validated
 * against a hardcoded union, the admin rendered one of three bespoke forms, and
 * redaction guessed which values were secret from their key names. Each of
 * those had to be edited to add a provider, so the extension point existed
 * without being reachable.
 *
 * A definition carries the answers instead. Core stops knowing provider names.
 *
 * @module domains/email/provider-definition
 */

import { NextlyError } from "../../errors";

import type { EmailProviderAdapter } from "./types";

/**
 * Longest provider type id that every dialect can store.
 *
 * Postgres and MySQL declare `email_providers.type` as `varchar(50)` while
 * SQLite is unbounded text, so a longer namespaced id registers fine, works on
 * SQLite, and is rejected or silently truncated on the other two. Truncation is
 * the worse half: the stored type would no longer match any registered
 * provider, leaving a row nothing can build an adapter for.
 *
 * Enforced at registration so the failure names the plugin at boot, rather than
 * appearing as a database error the first time someone saves a provider.
 */
export const MAX_EMAIL_PROVIDER_TYPE_LENGTH = 50;

/**
 * The single error for an over-long provider type.
 *
 * Shared by the authoring helper and the registry so one invariant does not
 * report itself two ways. A 500 would be wrong: nothing failed inside Nextly,
 * an install declared a provider it cannot store, and the person who can fix it
 * is reading the message. The type is named in the public sentence because it
 * comes from the install's own code, not from a request.
 */
export function emailProviderTypeTooLong(type: string): NextlyError {
  // No inline statusCode: `BUSINESS_RULE_VIOLATION` now carries 422 in the
  // canonical map, so every throw site of this code answers the same way and
  // a change to that meaning happens in one place.
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider type "${type}" is longer than ${MAX_EMAIL_PROVIDER_TYPE_LENGTH} characters, the width of the column every database stores it in. Shorten the type id.`,
    logContext: { type, max: MAX_EMAIL_PROVIDER_TYPE_LENGTH },
  });
}

/**
 * How one configuration value is entered and treated.
 *
 * Serializable on purpose: this is the only part of a definition that crosses
 * to the browser, so a provider can describe its form without shipping React,
 * depending on admin internals, or being renderable in only one place.
 */
export interface EmailProviderConfigField {
  /** Key within the stored `configuration` object. */
  name: string;
  /** Field label shown to whoever is configuring the provider. */
  label: string;
  /** Which control to render, and how to treat the value. */
  kind: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  /** Pre-filled when adding a provider of this type. */
  default?: string | number | boolean;
  /** One line under the field. Say what it is for, not what it is called. */
  help?: string;
  placeholder?: string;
  /** Choices for `kind: "select"`. Ignored otherwise. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /**
   * Marks a credential.
   *
   * Redaction reads this rather than inferring from the key name, which
   * mistakes a field called `credential` for public and a harmless one called
   * `token` for secret. Declaring it is the only way to be right about a name
   * core has never seen.
   */
  secret?: boolean;
  /**
   * Hints so the form can object before a round trip.
   *
   * Deliberately a tiny closed set rather than an expression language:
   * `parseConfig` stays authoritative, and a rule that can only live there
   * cannot drift from a copy here. A provider whose constraint does not fit in
   * these three keys should express it in `parseConfig` alone.
   */
  constraints?: { min?: number; max?: number; maxLength?: number };
  /**
   * What a BLANK value means for this field, when the field is optional.
   *
   * A client editing a stored provider can express three things about an
   * optional field — leave it, set it, remove it — and a blank input has to be
   * mapped onto one of them. Which one is right depends entirely on how the
   * provider's own parser is written, and nothing else in the descriptor says:
   *
   * - `"omit"` (the default) suits `z.string().min(1).optional()` and
   *   `z.enum(...).optional()`, which accept an absent key and reject `""`.
   * - `"empty"` suits a key nested inside a REQUIRED object, where the parser
   *   demands the key exist and decides for itself what an empty value means.
   *   The built-in SMTP provider is the live example: `auth` is required and
   *   its `user`/`pass` may be empty for a loopback sink, so omitting them
   *   fails with "expected string, received undefined" for the one setup this
   *   repository documents.
   *
   * Declared rather than guessed, for the same reason `secret` is: a client
   * cannot read `parseConfig`, and the two shapes are indistinguishable from
   * the outside. Ignored for a required field, which can never be blank.
   */
  blankAs?: "omit" | "empty";
}

/** What a provider can do, so a UI never offers what it cannot honour. */
export interface EmailProviderCapabilities {
  /** Accepts file attachments. */
  attachments?: boolean;
  /** Can be probed without sending a message (`testConnection`). */
  connectionTest?: boolean;
  /** Honours a Reply-To address. */
  replyTo?: boolean;
  /**
   * Only accepts a sender on a domain verified with the provider.
   *
   * Declared rather than inferred. A hosted API provider generally requires it
   * and a self-hosted relay does not, but nothing else in the descriptor
   * distinguishes them — using the presence of `docsUrl` as the signal reads as
   * a rule and is a coincidence, and it silently drops the warning for any
   * provider that documents itself elsewhere.
   *
   * The consequence of getting it wrong is quiet: a provider saves cleanly with
   * an unusable sender and fails at the first send.
   */
  requiresVerifiedSender?: boolean;
}

/**
 * A registered mail provider.
 *
 * @typeParam TConfig - the shape `parseConfig` produces and `createAdapter`
 *   consumes. Defaulted so a definition can be held without naming it.
 */
export interface EmailProviderDefinition<TConfig = Record<string, unknown>> {
  /** Stored in `email_providers.type`. Unique across built-ins and plugins. */
  type: string;
  /** Shown in the provider picker. */
  label: string;
  description?: string;
  /** Where to read about getting credentials. */
  docsUrl?: string;
  /**
   * One line about which sender addresses this provider will accept.
   *
   * Shown beside the From address. Only for a provider whose rule cannot be
   * derived from `capabilities.requiresVerifiedSender` alone — Resend, for
   * instance, publishes a shared testing address that works before any domain
   * is verified, and a form that says only "use a verified domain" makes a
   * usable configuration look impossible.
   *
   * Prose in a wire format is a cost, and it is the same cost `help` and
   * `description` already pay: the alternative is provider-specific copy
   * hardcoded in a client, which is what a catalog exists to end.
   */
  senderGuidance?: string;
  capabilities?: EmailProviderCapabilities;
  /** Field metadata, in the order a form should render it. */
  configFields: ReadonlyArray<EmailProviderConfigField>;
  /**
   * Validate stored or submitted configuration. The authoritative boundary.
   *
   * A function rather than a schema object so no validation library becomes
   * part of the provider contract: a package may use Zod internally, but a Zod
   * major would otherwise break every third-party provider at once, and each
   * would have to resolve a version compatible with core's.
   *
   * Throws when the input cannot be used. `NextlyError.validation` gives the
   * caller field paths; any thrown error is caught and reported by the service.
   */
  parseConfig: (input: unknown) => TConfig;
  /** Build the adapter that sends. */
  createAdapter: (config: TConfig) => EmailProviderAdapter;
  /**
   * Cheap reachability probe that sends nothing.
   *
   * Only meaningful where the protocol has one — SMTP can open a session and
   * authenticate, a REST provider generally cannot check anything short of
   * sending. Declare `capabilities.connectionTest` alongside it, so a UI can
   * tell the difference between "this failed" and "this cannot be asked".
   */
  testConnection?: (
    config: TConfig
  ) => Promise<{ ok: boolean; detail?: string }>;
}

/**
 * The control kinds a credential may be entered with.
 *
 * A secret is masked on read, which means the value a client holds for it is a
 * STRING that stands for the stored one. Only a textual control can carry that:
 * a switch has nowhere to put a mask, a select would have to list it as an
 * option, and a number input rejects it outright. A provider declaring `secret`
 * on any of those describes a field that cannot be edited without being
 * replaced, so it is refused where the definition is written rather than
 * discovered when someone tries to save one.
 */
const SECRET_CAPABLE_KINDS: ReadonlyArray<EmailProviderConfigField["kind"]> = [
  "text",
  "password",
];

/**
 * Path segments a configuration key may never contain.
 *
 * A field name is a PATH that both the service and any client walk to read and
 * write a value. These three do not name a property of the configuration; they
 * reach the object prototype. A client assembling a form from the descriptor
 * would write through one and corrupt every plain object it holds — and merely
 * opening the form is enough, no save required.
 *
 * Refused at registration because that is the only place with the whole list,
 * and because a provider cannot be made safe afterwards: every consumer of the
 * descriptor would have to remember the same rule.
 */
const UNWALKABLE_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** The value type each control can actually hold. */
const DEFAULT_TYPE_FOR_KIND: Record<
  EmailProviderConfigField["kind"],
  "string" | "number" | "boolean"
> = {
  text: "string",
  password: "string",
  select: "string",
  number: "number",
  boolean: "boolean",
};

/** Reject a field name that cannot be walked safely. */
function assertFieldNameIsWalkable(
  type: string,
  field: EmailProviderConfigField
): void {
  if (PATH_RESERVED_CHARACTERS.test(field.name)) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares the configuration field "${field.name}". A field name may not contain brackets or quotes: a form library reads those as structure and would store the value somewhere other than where it is validated and sent.`,
      logContext: { type, field: field.name },
    });
  }

  const segments = field.name.split(".");

  // A numeric segment is read as an ARRAY INDEX by the form library and as a
  // literal key by everything else: `servers.0.host` registers as
  // `{ servers: [{ host }] }` in the form and is validated and sent as
  // `{ servers: { "0": { host } } }`. Same declaration, two shapes, and
  // nothing positioned to notice the disagreement.
  const numeric = segments.find(segment => /^\d+$/.test(segment));
  if (numeric !== undefined) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares the configuration field "${field.name}", whose segment "${numeric}" is a number. A form library reads a numeric segment as an array index while the rest of the contract reads it as a key, so the value would be stored somewhere other than where it is validated.`,
      logContext: { type, field: field.name, segment: numeric },
    });
  }

  const offender = segments.find(
    segment => segment === "" || UNWALKABLE_PATH_SEGMENTS.has(segment)
  );
  if (offender === undefined) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" declares the configuration field "${field.name}", whose path segment "${offender}" cannot be used. A field name is a dotted path into stored configuration and may not contain an empty segment or reach an object prototype.`,
    logContext: { type, field: field.name, segment: offender },
  });
}

/**
 * Reject a default a control cannot hold.
 *
 * `default` is typed as the union of all three primitives, which is right for
 * one property covering five kinds and wrong for any single field: a select
 * defaulting to `true` renders as unselected and then fails its own generated
 * string schema before anyone touches it, and a number field defaulting to
 * `"3"` renders blank while quietly submitting a string. Correlating the two is
 * a rule rather than a type, so it is checked where the definition is written.
 */
function assertDefaultMatchesKind(
  type: string,
  field: EmailProviderConfigField
): void {
  if (field.default === undefined) return;

  const expected = DEFAULT_TYPE_FOR_KIND[field.kind];
  if (typeof field.default === expected) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" gives the ${field.kind} field "${field.name}" a ${typeof field.default} default. A ${field.kind} field can only default to a ${expected}.`,
    logContext: {
      type,
      field: field.name,
      kind: field.kind,
      defaultType: typeof field.default,
    },
  });
}

/**
 * Reject a default on a credential, and a blank-as-empty on a kind that has no
 * empty value.
 *
 * **A secret default cannot be honoured.** `toDescriptor` strips it, correctly:
 * the descriptor is served to anyone holding read or create, so forwarding a
 * credential there would hand out the value stored configuration is masked to
 * protect. And nothing server-side applies descriptor defaults -- they are a
 * hint for the form and nothing else. A declared secret default is therefore
 * inert in both directions, while looking to its author like a working
 * fallback. A provider that wants one reads its environment inside
 * `parseConfig`, which is authoritative and never leaves the server.
 *
 * **`blankAs: "empty"` needs a kind whose blank IS an empty string.** A number
 * input's blank normalises to absent long before the payload is built, and a
 * switch always holds a value, so declaring it on either is a request the form
 * cannot carry out.
 */
function assertDeclarationsCanBeHonoured(
  type: string,
  field: EmailProviderConfigField
): void {
  if (field.secret === true && field.default !== undefined) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the credential "${field.name}" a default. A descriptor is served to any caller who can read providers, so a secret default is withheld from it — and nothing applies descriptor defaults on the server, so it would never be used. Read the fallback inside \`parseConfig\` instead.`,
      logContext: { type, field: field.name },
    });
  }

  if (
    field.blankAs === "empty" &&
    field.kind !== "text" &&
    field.kind !== "password" &&
    field.kind !== "select"
  ) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares \`blankAs: "empty"\` on the ${field.kind} field "${field.name}". Only a text, password or select field has an empty string to send; a blank number is absent and a switch is never blank.`,
      logContext: { type, field: field.name, kind: field.kind },
    });
  }
}

/**
 * How one text property is allowed to be absent or blank.
 *
 * - `"required"` — must be a non-empty string. Blank is refused because the
 *   value is a label somewhere: a control with no name, or a picker entry that
 *   cannot be told from its neighbours.
 * - `"identifier"` — must be a string, and emptiness belongs to another rule
 *   that reports it better than "empty" would.
 * - `"optional"` — may be omitted; if present it has to be a string.
 */
type TextRequirement = "required" | "identifier" | "optional";

/**
 * Reject descriptor text that is not text.
 *
 * A descriptor is the only part of a provider that crosses to the browser, and
 * the admin renders these values directly: `help` and `senderGuidance` become
 * React children, where a non-string throws and takes the settings page down
 * with it, and `label` is called as a string while building a select's
 * validation message. A descriptor is also structural, so a JavaScript plugin
 * or a hand-built object supplies whatever it wrote.
 *
 * Refused where the descriptor is published rather than where it is rendered:
 * the admin cannot say which install shipped the bad value, and by then the
 * only symptom is a blank page.
 */
function assertTextIsRenderable(
  type: string,
  subject: string,
  entries: ReadonlyArray<[key: string, value: unknown, rule: TextRequirement]>
): void {
  for (const [key, value, rule] of entries) {
    if (value === undefined && rule === "optional") continue;

    if (typeof value !== "string") {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" gives ${subject} a non-string \`${key}\` (${value === null ? "null" : typeof value}). Descriptor text is rendered by the admin as it arrives, so a value that is not a string breaks the page that would have shown it.`,
        logContext: { type, subject, key, valueType: typeof value },
      });
    }

    if (rule === "required" && value.trim().length === 0) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" gives ${subject} an empty \`${key}\`. It is what names this in the admin, so nothing else identifies it once it is blank.`,
        logContext: { type, subject, key },
      });
    }
  }
}

/**
 * Every text property a descriptor publishes about the provider itself.
 *
 * Exported for the same reason the field rules are: `RegisteredEmailProvider`
 * is structural, so the registry is a second door into the admin and checking
 * only the authoring helper would leave it open.
 */
export function assertProviderTextIsRenderable(provider: {
  type: string;
  label: string;
  description?: string;
  docsUrl?: string;
  senderGuidance?: string;
}): void {
  assertTextIsRenderable(String(provider.type), "the provider", [
    // Before the rules that read `.trim()` and `.length` off it. Emptiness is
    // left to the registry, whose message for it says more than "empty".
    ["type", provider.type, "identifier"],
    ["label", provider.label, "required"],
    ["description", provider.description, "optional"],
    ["docsUrl", provider.docsUrl, "optional"],
    ["senderGuidance", provider.senderGuidance, "optional"],
  ]);
}

/**
 * Reject metadata whose TYPE is wrong, before anything reads its value.
 *
 * Every rule in this file tests `field.secret === true` and
 * `field.required === true`, which is correct for a boolean and silently wrong
 * for anything else: `secret: "true"` is not `true`, so the field is treated as
 * PUBLIC — `declaredSecretPaths` omits it while `declaredConfigPaths` still
 * recognises it, and `maskConfiguration` then returns the credential in clear
 * text to anyone who can read providers.
 *
 * `configFields` is a structural type, so a JavaScript plugin or a hand-built
 * object reaches registration with whatever it wrote. A truthy string is the
 * dangerous case precisely because it looks right.
 */
function assertFlagsAreBoolean(
  type: string,
  field: EmailProviderConfigField
): void {
  const flags: Array<[string, unknown]> = [
    ["secret", field.secret],
    ["required", field.required],
  ];

  for (const [name, value] of flags) {
    if (value === undefined || typeof value === "boolean") continue;
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the field "${field.name}" a non-boolean \`${name}\` (${typeof value}). Only \`true\` marks a field, so any other value reads as unset — for \`secret\` that means the credential is served in the clear.`,
      logContext: { type, field: field.name, flag: name, kind: typeof value },
    });
  }
}

/**
 * Reject a default that its own field would refuse.
 *
 * A form initialises from the default and validates against the same
 * constraints, so a default outside them opens the form already invalid and
 * the operator has to change a value they never chose in order to submit. The
 * descriptor is the only place both halves are visible, so it is where they
 * are checked against each other.
 */
function assertDefaultSatisfiesConstraints(
  type: string,
  field: EmailProviderConfigField
): void {
  const value = field.default;
  if (value === undefined) return;
  const { min, max, maxLength } = field.constraints ?? {};

  // Requiredness is a constraint the form applies too, and a blank string is
  // the value it applies it to: the generated schema reports an empty required
  // field as missing, so a descriptor pre-filling one opens every create form
  // already invalid. Checked before the bounds, which a blank satisfies -- it
  // has the right type and violates no maximum, which is exactly why it slipped
  // through them.
  if (
    field.required === true &&
    typeof value === "string" &&
    value.trim() === ""
  ) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the required field "${field.name}" a blank default. A required field rejects a blank, so the form opens on a value it will not accept and cannot be submitted until the operator changes something nobody chose. Omit the default, or make the field optional.`,
      logContext: { type, field: field.name },
    });
  }

  const violation =
    typeof value === "number" && min !== undefined && value < min
      ? `is below its minimum of ${min}`
      : typeof value === "number" && max !== undefined && value > max
        ? `is above its maximum of ${max}`
        : typeof value === "string" &&
            maxLength !== undefined &&
            value.length > maxLength
          ? `is longer than its maximum length of ${maxLength}`
          : undefined;

  if (violation === undefined) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" gives the field "${field.name}" a default of ${JSON.stringify(value)}, which ${violation}. A form starting on a value it must reject cannot be submitted without changing something nobody chose.`,
    logContext: {
      type,
      field: field.name,
      default: value,
      min,
      max,
      maxLength,
    },
  });
}

/**
 * Reject an optional boolean that does not say what "unset" looks like.
 *
 * A switch has two positions and no third. Without a default, an absent stored
 * key renders as OFF and every subsequent save writes `false` — so a parser
 * that distinguishes absence from false (an optional flag defaulting to true
 * server-side, say) is silently overwritten, and the clearing path cannot help
 * because a switch can never be "emptied" back to absence.
 *
 * Declaring the default removes the ambiguity at the source: the form starts
 * where the provider says, and the value it sends is always one the provider
 * chose. A field that genuinely needs three states is a select, not a switch.
 */
function assertOptionalBooleanHasDefault(
  type: string,
  field: EmailProviderConfigField
): void {
  if (field.kind !== "boolean") return;
  if (field.default !== undefined) return;
  // A REQUIRED boolean has no absence to represent: the form initialises the
  // switch to `false`, the generated schema accepts it, and both positions are
  // a value the provider asked for. Only an optional one has three states to
  // squeeze onto two positions.
  if (field.required === true) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" declares the boolean field "${field.name}" without a default. A switch has two positions, so an absent value would render as off and be saved as false — overwriting a provider default nobody changed. Declare \`default\`, or use a select if the field genuinely has three states.`,
    logContext: { type, field: field.name },
  });
}

/**
 * Reject two fields that claim the same place in the configuration.
 *
 * A declaration and one of its own descendants — `auth` beside `auth.pass` —
 * cannot both be represented: whichever is built second either overwrites the
 * other's branch or tries to treat a leaf as one. Neither order produces a
 * working form, and both fail somewhere far from the declaration, so the
 * overlap is refused where it is written.
 */
function assertNoOverlappingPaths(
  type: string,
  fields: ReadonlyArray<EmailProviderConfigField>
): void {
  const seen: string[][] = [];

  for (const field of fields) {
    const path = field.name.split(".");
    for (const other of seen) {
      const shorter = other.length <= path.length ? other : path;
      const longer = other.length <= path.length ? path : other;
      const overlaps = shorter.every((part, index) => part === longer[index]);
      if (!overlaps) continue;

      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" declares the configuration fields "${other.join(".")}" and "${field.name}", which claim the same place in the stored configuration. Field paths must not repeat or nest inside one another.`,
        logContext: { type, first: other.join("."), second: field.name },
      });
    }
    seen.push(path);
  }
}

/**
 * Reject a select nobody can choose from.
 *
 * Two shapes the type permits and no form can render. A select with no options
 * draws an empty control, and if it is required the provider can never be
 * saved. An option whose value is the empty string is worse: the admin's select
 * reserves `""` for "nothing selected" and throws on an item carrying it, so
 * merely opening the form reaches an error boundary.
 *
 * Refused here rather than worked around in a client, because every client
 * would otherwise need the same two workarounds and a form is not the place to
 * discover that a provider is undeclarable.
 */
function assertSelectIsChoosable(
  type: string,
  field: EmailProviderConfigField
): void {
  if (field.kind !== "select") return;

  // Shape first, because everything below reads it. `configFields` is a
  // structural type, so a JavaScript plugin or a hand-built provider reaches
  // here with whatever it wrote: an object crashes registration on
  // `options.some is not a function`, and `{ value: 1 }` passes silently and
  // then cannot be selected -- the control renders strings and the generated
  // schema validates strings, so the stored number matches no option.
  if (field.options !== undefined && !Array.isArray(field.options)) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the select field "${field.name}" an \`options\` that is not an array.`,
      logContext: { type, field: field.name },
    });
  }

  const options = field.options ?? [];

  const malformed = options.findIndex(
    option =>
      option === null ||
      typeof option !== "object" ||
      typeof option.value !== "string" ||
      typeof option.label !== "string"
  );
  if (malformed !== -1) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the select field "${field.name}" an option at index ${malformed} that is not \`{ value: string; label: string }\`. A non-string value cannot be selected: the control and the generated schema both work in strings.`,
      logContext: { type, field: field.name, index: malformed },
    });
  }

  if (options.length === 0) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares the select field "${field.name}" with no options. A select must offer at least one choice.`,
      logContext: { type, field: field.name },
    });
  }

  if (options.some(option => option.value === "")) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the select field "${field.name}" an option with an empty value. An empty value means "nothing selected", so it cannot also be a choice.`,
      logContext: { type, field: field.name },
    });
  }

  // A default outside its own option list renders as nothing selected and then
  // fails the schema generated from the same list, so the field arrives
  // invalid and the provider cannot be saved until someone changes a value
  // they never chose.
  if (
    field.default !== undefined &&
    !options.some(option => option.value === field.default)
  ) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" defaults the select field "${field.name}" to a value that is not one of its options.`,
      logContext: { type, field: field.name, default: String(field.default) },
    });
  }
}

/**
 * Characters a form library will read as structure rather than as a name.
 *
 * React Hook Form parses a registered path by splitting on `[` and stripping
 * brackets and quotes, while this contract and every consumer of it split on
 * dots alone. A field called `headers[x-api-key]` therefore registers as
 * `{ headers: { "x-api-key": … } }` in the form and is validated and sent as
 * `{ "headers[x-api-key]": … }` -- two different places in the configuration,
 * neither of which reports the disagreement.
 *
 * Measured rather than assumed: `set(values, "configuration.headers[x-api-key]", v)`
 * against react-hook-form produces the first shape, and the schema built from
 * the same descriptor expects the second.
 */
const PATH_RESERVED_CHARACTERS = /[[\]"']/;

/**
 * The control kinds a form knows how to render.
 *
 * The admin switches over this union exhaustively, which is a COMPILE-time
 * guarantee and no guarantee at all about a JavaScript plugin or a hand-built
 * object. A `kind` outside the set falls off the end of that switch, the field
 * gets no schema, and building the form recurses into `undefined` — so an
 * unrenderable kind takes down the whole provider form rather than skipping one
 * field.
 */
const RENDERABLE_KINDS: ReadonlyArray<EmailProviderConfigField["kind"]> = [
  "text",
  "password",
  "number",
  "boolean",
  "select",
];

/** Reject a control nothing can draw. */
function assertKindIsRenderable(
  type: string,
  field: EmailProviderConfigField
): void {
  if (RENDERABLE_KINDS.includes(field.kind)) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" declares the field "${field.name}" with kind "${String(field.kind)}", which no form can render. Use one of: ${RENDERABLE_KINDS.join(", ")}.`,
    logContext: { type, field: field.name, kind: String(field.kind) },
  });
}

/**
 * Reject numeric metadata that cannot survive the wire.
 *
 * A descriptor is served as JSON, and `JSON.stringify` turns `Infinity`,
 * `-Infinity` and `NaN` into `null`. A client then reads a present limit whose
 * value is `null`, and `value.length > null` is `value.length > 0` — so
 * `maxLength: Infinity`, declared to mean "no limit", rejects every non-empty
 * string and makes a required field impossible to submit.
 *
 * Refused at registration rather than coerced, because a provider author
 * writing `Infinity` means "unbounded" and the way to say that is to omit the
 * key. Silently dropping it would work and teach nothing.
 */
function assertNumericMetadataIsFinite(
  type: string,
  field: EmailProviderConfigField
): void {
  const candidates: Array<[string, number | undefined]> = [
    ["constraints.min", field.constraints?.min],
    ["constraints.max", field.constraints?.max],
    ["constraints.maxLength", field.constraints?.maxLength],
    ["default", typeof field.default === "number" ? field.default : undefined],
  ];

  for (const [key, value] of candidates) {
    if (value === undefined || Number.isFinite(value)) continue;
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" gives the field "${field.name}" a non-finite ${key} (${String(value)}). Descriptors are served as JSON, where that becomes null and reads as a real limit. Omit the key to mean "no limit".`,
      logContext: { type, field: field.name, key, value: String(value) },
    });
  }
}

/**
 * Which control each constraint describes, and the phrase naming those
 * controls in the refusal.
 *
 * A character limit describes a string the operator types; a numeric bound
 * describes a number input's value. Everything else either has no keyboard
 * behind it (a switch), takes its value from an option list (a select), or
 * measures the wrong quantity (`maxLength` on a number is not its magnitude).
 */
const CONSTRAINT_KINDS: ReadonlyArray<{
  key: "maxLength" | "min" | "max";
  kinds: ReadonlyArray<EmailProviderConfigField["kind"]>;
  applies: string;
}> = [
  {
    key: "maxLength",
    kinds: ["text", "password"],
    applies: "text or password",
  },
  { key: "min", kinds: ["number"], applies: "number" },
  { key: "max", kinds: ["number"], applies: "number" },
];

/**
 * Reject a constraint on a control that does not apply it.
 *
 * The generated form enforces `maxLength` in its text and password branch and
 * `min`/`max` in its number branch, and nowhere else. Declaring one elsewhere
 * publishes a constraint to every client that reads the descriptor while the
 * form it describes ignores it — so the operator is allowed to enter a value
 * the provider's own parser then rejects, after exactly the round trip the
 * hint existed to avoid.
 *
 * Refused rather than dropped, on the same reasoning as `blankAs` on a number:
 * an author who wrote it meant something by it, and a constraint that quietly
 * does nothing teaches the opposite.
 */
function assertConstraintsApplyToKind(
  type: string,
  field: EmailProviderConfigField
): void {
  for (const { key, kinds, applies } of CONSTRAINT_KINDS) {
    if (field.constraints?.[key] === undefined) continue;
    if (kinds.includes(field.kind)) continue;

    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares \`${key}\` on the ${field.kind} field "${field.name}". That constraint is only applied to a ${applies} field, so this one is published to every client and enforced by nothing.`,
      logContext: {
        type,
        field: field.name,
        kind: field.kind,
        constraint: key,
      },
    });
  }
}

/** Reject a text length no value can satisfy. */
function assertTextLengthIsSatisfiable(
  type: string,
  field: EmailProviderConfigField
): void {
  const maxLength = field.constraints?.maxLength;
  if (maxLength === undefined || maxLength >= 1) return;

  // A field that can hold at most zero characters is not a field. Required, it
  // rejects the empty string AND every non-empty one; optional, it permits
  // exactly nothing. Either way the provider can never be saved through a form
  // built from this descriptor.
  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" gives the field "${field.name}" a maximum length of ${maxLength}. No value can satisfy that.`,
    logContext: { type, field: field.name, maxLength },
  });
}

/** Reject a numeric range no value can satisfy. */
function assertNumericBoundsAreSatisfiable(
  type: string,
  field: EmailProviderConfigField
): void {
  const { min, max } = field.constraints ?? {};
  if (min === undefined || max === undefined || min <= max) return;

  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" gives the number field "${field.name}" a minimum of ${min} and a maximum of ${max}. No value can satisfy both, so the provider could never be saved.`,
    logContext: { type, field: field.name, min, max },
  });
}

/**
 * Every rule a provider's field metadata has to satisfy.
 *
 * Exported and called from BOTH the authoring helper and the registry.
 * `RegisteredEmailProvider` is a structural type, so a JavaScript plugin or a
 * hand-built object reaches registration without passing through
 * `defineEmailProvider` — checking in one place only would leave the rules
 * enforced for the authors least likely to break them.
 */
export function assertConfigFieldsAreUsable(
  type: string,
  fields: ReadonlyArray<EmailProviderConfigField>
): void {
  // The CONTAINER before anything in it. `configFields` is structural, so a
  // JavaScript plugin or a hand-built object reaches here with whatever it
  // wrote, and the loop below turns `null` into `fields is not iterable` and a
  // null entry into `Cannot read properties of null` -- raw TypeErrors that
  // name neither the provider nor the position, thrown from a boot path where
  // the only thing an operator can act on is which plugin to remove.
  if (!Array.isArray(fields)) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares \`configFields\` as ${fields === null ? "null" : typeof fields}. It has to be an array, even an empty one.`,
      logContext: { type, received: fields === null ? "null" : typeof fields },
    });
  }

  const malformed = fields.findIndex(
    field => field === null || typeof field !== "object"
  );
  if (malformed !== -1) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: `Email provider "${type}" declares a configuration field at index ${malformed} that is not an object. Every entry has to describe one field.`,
      logContext: { type, index: malformed },
    });
  }

  for (const field of fields) {
    // Text first, because `name` is how every rule below says WHICH field it
    // means and the walkability rule splits it: a non-string name otherwise
    // surfaces as `field.name.split is not a function`, which names neither
    // the plugin nor the field.
    assertTextIsRenderable(type, `the field "${String(field.name)}"`, [
      ["name", field.name, "identifier"],
      ["label", field.label, "required"],
      ["help", field.help, "optional"],
      ["placeholder", field.placeholder, "optional"],
    ]);
    // Then kind: every rule below reads it, and a rule that switches on an
    // unrenderable kind would report the wrong problem.
    assertKindIsRenderable(type, field);
    assertFieldNameIsWalkable(type, field);
    // Before every rule that reads a flag, so a wrong TYPE is reported as
    // itself rather than as the rule that silently read it as unset.
    assertFlagsAreBoolean(type, field);
    // Before every rule that reads `secret`: a credential declared on a
    // control that cannot hold one is the more fundamental mistake, and
    // reporting a rule about its default first would send the author to the
    // wrong line.
    if (field.secret === true && !SECRET_CAPABLE_KINDS.includes(field.kind)) {
      throw secretFieldMustBeTextual(type, field);
    }
    // Before the satisfiability rules, which compare these numbers: `NaN`
    // fails every comparison silently, so a bound of `NaN` would pass
    // "min <= max" and be reported as fine.
    assertNumericMetadataIsFinite(type, field);
    // Before satisfiability, which would report a `maxLength` of 0 on a select
    // as a limit no value meets rather than as a limit that control never
    // applies — sending the author to argue with the number instead of
    // removing the key.
    assertConstraintsApplyToKind(type, field);
    assertTextLengthIsSatisfiable(type, field);
    assertDefaultMatchesKind(type, field);
    assertDefaultSatisfiesConstraints(type, field);
    assertDeclarationsCanBeHonoured(type, field);
    assertOptionalBooleanHasDefault(type, field);
    assertSelectIsChoosable(type, field);
    assertNumericBoundsAreSatisfiable(type, field);
  }
  assertNoOverlappingPaths(type, fields);
}

/** The single error for a credential declared on a control that cannot hold one. */
export function secretFieldMustBeTextual(
  type: string,
  field: EmailProviderConfigField
): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: `Email provider "${type}" marks the ${field.kind} field "${field.name}" as secret. A credential is masked on read, so it can only be declared on a text or password field. Change the kind, or drop \`secret\`.`,
    logContext: { type, field: field.name, kind: field.kind },
  });
}

/**
 * A registered definition with its config type erased.
 *
 * The registry holds providers whose `TConfig`s differ, and no single generic
 * argument describes them all: `parseConfig` and `createAdapter` are
 * contravariant in it, so `EmailProviderDefinition<unknown>` rejects every
 * concrete definition.
 *
 * The erased form takes `unknown` and never exposes the parsed value, which
 * removes the need to cast one back. `createAdapterFrom` parses AND builds, so
 * the typed value stays inside the closure that knows its type — and an
 * adapter cannot be constructed from configuration that was never validated.
 * That is a safety property, not only a typing convenience.
 */
export interface RegisteredEmailProvider {
  type: string;
  label: string;
  description?: string;
  docsUrl?: string;
  senderGuidance?: string;
  capabilities?: EmailProviderCapabilities;
  configFields: ReadonlyArray<EmailProviderConfigField>;
  /** Throw if this configuration is unusable. Discards the parsed value. */
  validateConfig: (input: unknown) => void;
  /** Validate and build in one step; the parsed value never escapes. */
  createAdapterFrom: (input: unknown) => EmailProviderAdapter;
  /** Present only when the definition supplied a probe. */
  testConnectionFrom?: (
    input: unknown
  ) => Promise<{ ok: boolean; detail?: string }>;
  /** Whether a probe exists, without exposing it. */
  readonly hasConnectionTest: boolean;
}

/**
 * A provider failure, split into what may be shown and what must be logged.
 *
 * Normalising a provider's own error moves the useful half onto `cause`, where
 * a log line reading `error.message` no longer sees it — so the operator gets
 * "the reason is in the server log" and a log containing that same sentence.
 * Shared by every site that reports one, because two sites deciding separately
 * how deep to look is how one of them ends up looking one level short.
 *
 * The chain is walked rather than read once: a provider may wrap its own error
 * before throwing, and the sentence worth having is at the bottom.
 */
export function describeProviderFailure(error: unknown): {
  message: string;
  cause?: string;
} {
  const message = error instanceof Error ? error.message : String(error);

  const causes: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  // Bounded: a cycle in a `cause` chain would otherwise hang the log call that
  // was meant to describe a failure.
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    causes.push(current.message);
    current = current.cause;
  }

  return causes.length > 0
    ? { message, cause: causes.join(": ") }
    : { message };
}

/**
 * Register a provider, erasing its config type.
 *
 * This is the function a provider package calls. Its argument stays fully
 * typed, so an author gets checking on the shape they actually wrote, while
 * the registry receives something it can store beside every other provider.
 */
export function defineEmailProvider<TConfig>(
  definition: EmailProviderDefinition<TConfig>
): RegisteredEmailProvider {
  assertProviderTextIsRenderable(definition);

  if (definition.type.length > MAX_EMAIL_PROVIDER_TYPE_LENGTH) {
    throw emailProviderTypeTooLong(definition.type);
  }

  assertConfigFieldsAreUsable(definition.type, definition.configFields);

  // Captured so the branch below narrows: an optional read off the object
  // inside a closure does not stay narrowed, and asserting it would hide a
  // definition that removed the probe after registration.
  const probe = definition.testConnection;

  /**
   * Parse, turning any failure into one the API boundary can report.
   *
   * A provider is free to validate with whatever library it likes, and the
   * documented example uses `schema.parse(input)` — which throws that library's
   * own error. Unrecognised errors are classified as internal, so a caller's
   * malformed configuration would come back as a 500 rather than as the
   * validation failure it is. A deliberately thrown `NextlyError` passes
   * through untouched, so a provider that wants specific field paths keeps them.
   */
  const parse = (input: unknown): TConfig => {
    try {
      return definition.parseConfig(input);
    } catch (error) {
      // `NextlyError.is` rather than `instanceof`: a provider package bundling
      // its own copy of nextly throws an error from a different class object,
      // and the brand is what survives that boundary. Without it, a plugin's
      // carefully-pathed validation error would be flattened below.
      if (NextlyError.is(error)) throw error;

      // The parser's own message is NOT made public. A plugin may interpolate
      // configuration into it -- `Invalid API key ${input.apiKey}` is an easy
      // thing to write -- and adapter resolution parses DECRYPTED stored
      // configuration before sending, so an authenticated caller could provoke
      // a failure and read back a credential the masked provider APIs exist to
      // withhold. The original is kept as the logged cause for operators.
      throw NextlyError.validation({
        errors: [
          {
            path: "configuration",
            code: "INVALID_PROVIDER_CONFIG",
            message: "Provider configuration is invalid.",
          },
        ],
        cause: error instanceof Error ? error : undefined,
        logContext: { providerType: definition.type },
      });
    }
  };

  /**
   * Keep a provider's own failure out of a response.
   *
   * `createAdapter` and `testConnection` receive DECRYPTED configuration, and
   * `testProvider` reports a caught error's `message` to the caller. A provider
   * that writes its configuration into a diagnostic — `Invalid key ${apiKey}`
   * is an easy thing to write — would therefore hand a credential back to any
   * authenticated caller who pressed Test, which is the exact leak the parse
   * wrapper already closes for `parseConfig`.
   *
   * A deliberately thrown `NextlyError` passes through, for the same reason it
   * does there: its `publicMessage` is an authoring decision about what is safe
   * to show, while a bare `Error`'s message is whatever the throw site
   * happened to interpolate.
   */
  const normalizeCallbackFailure = (
    error: unknown,
    stage: "createAdapter" | "testConnection" | "send"
  ): unknown => {
    if (NextlyError.is(error)) return error;
    // Constructed rather than `NextlyError.internal()`, which fixes its own
    // public sentence: naming the provider is what tells an operator which of
    // several configured providers failed, and the type comes from the
    // install's own code rather than from a request.
    return new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: `The "${definition.type}" email provider failed. Check the server logs for the reason.`,
      cause: error instanceof Error ? error : undefined,
      logContext: { providerType: definition.type, stage },
    });
  };

  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    docsUrl: definition.docsUrl,
    senderGuidance: definition.senderGuidance,
    capabilities: definition.capabilities,
    configFields: definition.configFields,
    validateConfig: (input: unknown): void => {
      parse(input);
    },
    createAdapterFrom: (input: unknown): EmailProviderAdapter => {
      const config = parse(input);
      let adapter: EmailProviderAdapter;
      try {
        adapter = definition.createAdapter(config);
      } catch (error) {
        throw normalizeCallbackFailure(error, "createAdapter");
      }

      // The adapter CLOSES OVER the parsed configuration, so its `send` is the
      // longest-lived route from a credential to an error message: building it
      // succeeds and the disclosure happens later, on a rejection nothing here
      // would otherwise see. Wrapping the factory alone left that open.
      //
      // `adapter.send(...)` is called through the adapter rather than a
      // detached reference, so a class-based implementation keeps its `this`.
      return {
        ...adapter,
        send: async options => {
          try {
            return await adapter.send(options);
          } catch (error) {
            throw normalizeCallbackFailure(error, "send");
          }
        },
      };
    },
    testConnectionFrom: probe
      ? async (input: unknown) => {
          // Awaited inside the try so a rejected promise is normalized too —
          // returning it unawaited would leave the async half of exactly the
          // same leak open.
          try {
            return await probe(parse(input));
          } catch (error) {
            throw normalizeCallbackFailure(error, "testConnection");
          }
        }
      : undefined,
    hasConnectionTest: typeof probe === "function",
  };
}

/**
 * The browser-safe half of a definition.
 *
 * Sent to the admin so it can render a form for a provider core was never
 * compiled against. Functions are dropped rather than serialized to `undefined`
 * by accident, and nothing here carries a stored value.
 */
export interface EmailProviderDescriptor {
  type: string;
  label: string;
  description?: string;
  docsUrl?: string;
  senderGuidance?: string;
  capabilities: EmailProviderCapabilities;
  configFields: ReadonlyArray<EmailProviderConfigField>;
}

/** Reduce a registered provider to what may safely leave the server. */
export function toDescriptor(
  provider: RegisteredEmailProvider
): EmailProviderDescriptor {
  return {
    type: provider.type,
    label: provider.label,
    description: provider.description,
    docsUrl: provider.docsUrl,
    senderGuidance: provider.senderGuidance,
    capabilities: {
      ...provider.capabilities,
      // Derived, not echoed: a definition that claims the capability without
      // supplying a probe would advertise a button that cannot do anything.
      // Derived from the callback that actually exists, not from either
      // declared flag. `RegisteredEmailProvider` is structural, so a hand-built
      // provider can set `hasConnectionTest: true` and omit the callback -- the
      // descriptor would then advertise a probe the service cannot find.
      connectionTest:
        provider.capabilities?.connectionTest === true &&
        typeof provider.testConnectionFrom === "function",
    },
    // A default on a secret field is stripped, even though registration
    // refuses one: `RegisteredEmailProvider` is structural, so a hand-built
    // provider can reach a descriptor build without having been registered.
    // The descriptor is served to anyone holding read or create, and
    // forwarding a credential there would hand out the value stored
    // configuration is masked to protect. The field is still described; only
    // its value is withheld.
    configFields: provider.configFields.map(field =>
      field.secret === true && field.default !== undefined
        ? { ...field, default: undefined }
        : field
    ),
  };
}
