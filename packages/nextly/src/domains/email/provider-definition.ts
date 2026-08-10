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
}

/** What a provider can do, so a UI never offers what it cannot honour. */
export interface EmailProviderCapabilities {
  /** Accepts file attachments. */
  attachments?: boolean;
  /** Can be probed without sending a message (`testConnection`). */
  connectionTest?: boolean;
  /** Honours a Reply-To address. */
  replyTo?: boolean;
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
 * Register a provider, erasing its config type.
 *
 * This is the function a provider package calls. Its argument stays fully
 * typed, so an author gets checking on the shape they actually wrote, while
 * the registry receives something it can store beside every other provider.
 */
export function defineEmailProvider<TConfig>(
  definition: EmailProviderDefinition<TConfig>
): RegisteredEmailProvider {
  if (definition.type.length > MAX_EMAIL_PROVIDER_TYPE_LENGTH) {
    throw emailProviderTypeTooLong(definition.type);
  }

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

  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    docsUrl: definition.docsUrl,
    capabilities: definition.capabilities,
    configFields: definition.configFields,
    validateConfig: (input: unknown): void => {
      parse(input);
    },
    createAdapterFrom: (input: unknown): EmailProviderAdapter =>
      definition.createAdapter(parse(input)),
    testConnectionFrom: probe
      ? (input: unknown) => probe(parse(input))
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
    // A default on a secret field is stripped. The type permits one -- a
    // provider might reasonably want `default: process.env.PROVIDER_KEY` -- and
    // the descriptor is served to anyone holding read or create, so forwarding
    // it would hand out the credential that stored configuration is masked to
    // protect. The field is still described; only its value is withheld.
    configFields: provider.configFields.map(field =>
      field.secret === true && field.default !== undefined
        ? { ...field, default: undefined }
        : field
    ),
  };
}
