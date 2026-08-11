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
 * What an adapter's `send` resolves to.
 *
 * Derived from the adapter contract rather than restated, so a change to what
 * a provider may return cannot leave the containment below checking a shape
 * nothing produces any more.
 */
type EmailSendResult = Awaited<ReturnType<EmailProviderAdapter["send"]>>;

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
 * Whether the configuration holds a leaf no field declares.
 *
 * Walked as PATHS, matching how `configFields[].name` addresses nested values
 * (`auth.pass`), so a declared branch's children are covered by their own
 * declarations rather than by the branch.
 */
function hasUndeclaredLeaf(
  fields: ReadonlyArray<EmailProviderConfigField>,
  config: Record<string, unknown>
): boolean {
  const declared = new Set(fields.map(field => field.name));

  const walk = (value: unknown, prefix: string): boolean => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return !declared.has(prefix);
    }
    return Object.entries(value as Record<string, unknown>).some(
      ([key, leaf]) => walk(leaf, prefix ? `${prefix}.${key}` : key)
    );
  };

  return Object.entries(config).some(([key, value]) => walk(value, key));
}

/**
 * The values a provider DECLARED as credentials, read out of its configuration.
 *
 * Declared rather than guessed, exactly as masking does: a heuristic over key
 * names calls `credential` public and a harmless `token` secret, and it can
 * only ever be right about names core has seen.
 *
 * A value of one to three characters cannot be compared safely: it matches
 * almost any identifier, so using it as a needle would delete every message id
 * the provider returns. It is reported as UNMATCHABLE rather than skipped, and
 * the caller drops the id instead of trying to match it.
 *
 * A provider that declares NO fields is the same case. An empty list is an
 * absence of information, not a statement that nothing is secret — the service
 * masks every configuration leaf for exactly that reason — so containment
 * fails closed here too.
 */
/** What containment knows about a provider's declared credentials. */
interface DeclaredSecretValues {
  comparable: string[];
  /** Anything at all that makes an identifier from this provider untrustworthy. */
  hasUnmatchable: boolean;
  /**
   * The part of that caused by a VALUE this configuration actually holds and
   * which cannot serve as a needle: a boolean credential, or a scalar short
   * enough that comparing against it would delete every legitimate id.
   *
   * Separated from the rest because the two travel differently between the
   * stored configuration and the parsed one. A missing key or an undeclared
   * leaf describes the SHAPE of a configuration, and a parser is entitled to
   * change that -- filling a default, deriving a working field -- so reading
   * it from the parsed form would withhold every id from every provider that
   * has a default. A value too short or too ambiguous to compare is not about
   * shape: whichever side holds it, something the adapter can interpolate
   * cannot be recognised on the way out.
   */
  hasUncomparableValue: boolean;
}

function declaredSecretValues(
  fields: ReadonlyArray<EmailProviderConfigField>,
  config: unknown
): DeclaredSecretValues {
  if (config === null || typeof config !== "object") {
    return {
      comparable: [],
      hasUnmatchable: false,
      hasUncomparableValue: false,
    };
  }

  // No metadata and a configuration to protect: nothing here can say which
  // leaf is a credential, so no message id from this provider can be trusted.
  // `declaredSecretPaths` reaches the same conclusion and masks everything.
  if (fields.length === 0) {
    return {
      comparable: [],
      // Shape, not value: nothing here names a credential, so every id from
      // this provider is untrustworthy — but a parser that adds keys to a
      // configuration nobody described has not made it any worse.
      hasUnmatchable: Object.keys(config).length > 0,
      hasUncomparableValue: false,
    };
  }

  const comparable: string[] = [];
  let hasUnmatchable = false;
  let hasUncomparableValue = false;

  // A configuration leaf no field DECLARES is treated as secret by
  // `maskConfiguration`, on the reasoning that absence of information has to
  // mask more rather than less -- a credential left behind by a provider
  // upgrade is exactly the case. Containment has to agree, or a legacy API key
  // is withheld from every read and then handed back inside a message id.
  //
  // Its value is not compared, because an undeclared leaf may be anything;
  // its mere presence makes ids from this provider untrustworthy.
  if (hasUndeclaredLeaf(fields, config as Record<string, unknown>)) {
    hasUnmatchable = true;
  }

  for (const field of fields) {
    if (field.secret !== true) continue;
    let current: unknown = config;
    for (const segment of field.name.split(".")) {
      if (current === null || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    // Every SCALAR, not only strings. A declared credential may be a number --
    // a numeric PIN on a `kind: "number"` field is a legal declaration -- and
    // reading only strings hands back an empty list for exactly the provider
    // whose credential is about to be interpolated into an identifier.
    //
    // A BOOLEAN credential is unmatchable rather than compared. `secret: true`
    // is permitted on a boolean field, and its two renderings -- "true" and
    // "false" -- appear inside ordinary identifiers often enough that using
    // them as needles would delete legitimate message ids while catching the
    // credential only by accident.
    if (typeof current === "boolean") {
      hasUnmatchable = true;
      hasUncomparableValue = true;
      continue;
    }

    // A declared credential ABSENT from the stored configuration is the case a
    // parser default fires on -- `z.string().default(process.env.KEY)` fills an
    // undefined key and the adapter then holds a credential that was never
    // stored, so there is nothing here to compare an id against. Absence is
    // distinguished from an empty value on purpose: a default does not fire for
    // `""`, so the adapter holds the empty string and has no secret to leak.
    // The built-in SMTP provider's loopback sink sends `auth.pass` as `""` and
    // keeps its message ids because of that distinction.
    if (current === undefined) {
      hasUnmatchable = true;
      continue;
    }

    // An object or an array is skipped: its rendering is not what a provider
    // would interpolate, and stringifying one produces a needle that matches
    // nothing while looking like protection.
    const scalar =
      typeof current === "string"
        ? current
        : typeof current === "number" || typeof current === "bigint"
          ? String(current)
          : undefined;
    if (scalar === undefined || scalar.length === 0) continue;
    // Both the stored form and its trimmed form. A parser is free to normalise
    // what it is handed -- `z.string().trim()` is the ordinary way to write a
    // credential field -- and the adapter then closes over the trimmed value
    // while this only ever sees what was stored. Comparing the stored form
    // alone lets `"  key  "` be returned inside `id-key`, which is the whole
    // disclosure this exists to stop.
    for (const needle of new Set([scalar, scalar.trim()])) {
      if (needle.length === 0) continue;
      // A secret of one to three characters matches almost any identifier, so
      // comparing against it would delete every message id this provider
      // returns. It cannot be compared safely and it cannot be ignored either
      // -- it is recorded as UNMATCHABLE, and the caller drops the id
      // outright. Applied per needle, so a credential that is long only
      // because of its whitespace is treated as the short one it really is.
      if (needle.length < 4) {
        hasUnmatchable = true;
        hasUncomparableValue = true;
      } else comparable.push(needle);
    }
  }

  return { comparable, hasUnmatchable, hasUncomparableValue };
}

/**
 * Drop a `messageId` that carries one of this provider's credentials.
 *
 * Dropped rather than redacted. A message id exists to be matched against the
 * provider's own record of the send, and a partially rewritten one matches
 * nothing while still looking like an identifier — so the honest outcome is
 * that this send has no id. The row is still written, and still says the
 * message was sent.
 */
function withoutLeakedSecrets(
  result: EmailSendResult,
  secrets: { comparable: readonly string[]; hasUnmatchable: boolean }
): EmailSendResult {
  const messageId = result.messageId;
  if (typeof messageId !== "string") return result;

  // A provider holding a secret too short to compare loses its message ids
  // entirely. That is the honest trade: the id is a convenience for matching a
  // send against the provider's own dashboard, and a credential in a database
  // column is not recoverable. A provider that wants its ids back declares a
  // longer credential.
  if (secrets.hasUnmatchable) return { ...result, messageId: undefined };

  // Case-insensitive, for the same reason the trimmed form is compared: a
  // parser that lowercases a hex token leaves the adapter holding a value this
  // never saw. An id that carries the credential in any casing is dropped.
  const haystack = messageId.toLowerCase();
  if (
    !secrets.comparable.some(secret => haystack.includes(secret.toLowerCase()))
  ) {
    return result;
  }
  return { ...result, messageId: undefined };
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

  // Built raw, then contained. The wrapper is the same one `register()` applies
  // to a hand-built provider, so the two cannot come to differ about what a
  // callback is allowed to let out -- and applying it twice is harmless, which
  // is what makes enforcing at both ends safe.
  return containProviderCallbacks({
    type: definition.type,
    label: definition.label,
    description: definition.description,
    docsUrl: definition.docsUrl,
    capabilities: definition.capabilities,
    configFields: definition.configFields,
    validateConfig: (input: unknown): void => {
      parse(input);
    },
    // Parses AND builds, so the typed value never escapes the closure that
    // knows its type. Nothing here catches: the containment above does it.
    createAdapterFrom: (input: unknown): EmailProviderAdapter => {
      const config = parse(input);
      const adapter = definition.createAdapter(config);

      // Needles from the configuration the ADAPTER actually holds, which is
      // the only place they exist. `containProviderCallbacks` wraps this from
      // the outside and can only see the STORED input, so a parser that
      // derives a credential -- Base64-encoding a key, deriving a token --
      // leaves it comparing a value the adapter never used. Here the parsed
      // form is in scope, so the effective credential is compared too.
      //
      //
      // The stored side is read too, and BOTH sets of needles are compared.
      // The outer wrapper passes a `NextlyError` through untouched, so once
      // this one normalises a failure the outer policy no longer runs -- and
      // an inner containment carrying only half the needles would quietly
      // become the whole of it.
      const effective = declaredSecretValues(definition.configFields, config);
      const stored = declaredSecretValues(definition.configFields, input);
      const fromParsed: DeclaredSecretValues = {
        comparable: [...stored.comparable, ...effective.comparable],
        // The stored side contributes every reason it has. A parser filling in
        // defaults produces keys the descriptor never declared, and reading
        // that from the parsed form would withhold every id from every
        // provider that has a default; an undeclared leaf in what was STORED
        // really is a credential nobody described.
        //
        // The parsed side contributes only a value it holds that cannot be
        // compared. A parser is free to shorten a credential -- `"00007"`
        // becomes `7` under a numeric coercion -- and the adapter then
        // interpolates a value no needle here can recognise while the stored
        // form still looks perfectly matchable. Dropping that reason with the
        // rest let `id-7` through.
        hasUnmatchable: stored.hasUnmatchable || effective.hasUncomparableValue,
        hasUncomparableValue:
          stored.hasUncomparableValue || effective.hasUncomparableValue,
      };

      return {
        ...adapter,
        send: async options => {
          try {
            return withoutLeakedSecrets(
              await adapter.send(options),
              fromParsed
            );
          } catch (error) {
            // Normalised here rather than thrown contained. The wrapper around
            // this one passes a `NextlyError` through untouched, on the
            // reading that a provider chose it deliberately -- so throwing a
            // bare contained value would make it the error the caller sees,
            // in place of the sentence naming which provider failed.
            throw normalizeProviderFailure(
              definition.type,
              error,
              "send",
              fromParsed
            );
          }
        },
      };
    },
    testConnectionFrom: probe
      ? (input: unknown) => probe(parse(input))
      : undefined,
    hasConnectionTest: typeof probe === "function",
  });
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
/**
 * A provider callback's failure, as it is allowed to leave the provider.
 *
 * A deliberately thrown `NextlyError` passes through: its `publicMessage` is an
 * authoring decision about what is safe to show, while a bare `Error`'s message
 * is whatever the throw site happened to interpolate — and a provider that
 * writes its configuration into a diagnostic (`Invalid key ${apiKey}` is an
 * easy thing to write) would otherwise hand a credential to any authenticated
 * caller who pressed Test.
 *
 * The provider's own text is not lost: it is moved onto `cause`, which is what
 * the log reads.
 */
/** What a declared credential is replaced with when it appears in a diagnostic. */
const REDACTED_SECRET = "[secret]";

/**
 * Every occurrence of one literal, whatever its case.
 *
 * The literal is escaped before it becomes a pattern: a credential may contain
 * characters a regular expression reads as syntax, and an unescaped one either
 * matches the wrong text or throws while building.
 *
 * A pattern rather than a hand-rolled scan over `toLowerCase()`, for two
 * reasons that both bite in production. Case folding can CHANGE LENGTH -- `İ`
 * lowercases to two code units -- so an index found in a folded copy does not
 * address the original, and enough of them ahead of a credential shift the
 * replacement clear of it and leave the whole secret in the text. And a folded
 * copy taken per match makes the work grow with the number of matches, so a
 * provider quoting a large remote error body back turns the failure path into
 * a stall. Matching over the ORIGINAL string keeps offsets exact by having
 * none, and one pass is one pass.
 */
function caseInsensitivePattern(literal: string): RegExp {
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

/**
 * A provider's own diagnostic, with its declared credentials taken out.
 *
 * A thrown error is the longest route a credential has out of a provider: the
 * wrapper keeps it out of the response by refusing to make the message public,
 * but `describeProviderFailure` walks the `cause` chain into the `email.failed`
 * log line, and `Error(config.apiKey)` is an easy thing for a provider to
 * write. A process log is shipped to aggregators and read by more people than
 * the configuration is.
 *
 * Done HERE rather than at the log site because this is the only place that
 * knows which values are credentials — the same knowledge the message-id
 * containment beside it uses.
 *
 * The rest of the text survives. An SMTP status line or an API error code is
 * the one fact worth having when a send fails, and redacting the whole
 * diagnostic to remove a credential that may not be in it would trade a real
 * disclosure for a permanent loss of the reason.
 */
function containedFailure(
  error: unknown,
  secrets: DeclaredSecretValues
): Error | undefined {
  if (!(error instanceof Error)) return undefined;

  const texts: string[] = [];
  let current: unknown = error;
  // Bounded like the reader that consumes this: a cycle in a `cause` chain
  // must not hang the failure path.
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    texts.push(current.message);
    current = current.cause;
  }

  // Nothing here can say which text is safe, so none of it is kept -- the same
  // answer the message id gets when its credentials cannot be compared.
  if (secrets.hasUnmatchable) {
    return new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "Provider diagnostics were withheld: this provider's credentials cannot be checked for in its own text.",
      logContext: { reason: "provider-diagnostic-unmatchable" },
    });
  }

  // Case-insensitively, for the same reason the message id is compared that
  // way: a parser that lowercases a key leaves the adapter holding a spelling
  // this never saw, and a provider quoting it back would slip past an exact
  // match. Rebuilt by index rather than by regular expression, because a
  // credential may contain characters a pattern would read as syntax.
  let text = texts.join(": ");
  // LONGEST first. A provider may declare one credential that is a prefix of
  // another -- `sk_live` beside `sk_live_REAL_SECRET` -- and redacting the
  // short one first consumes the head of the long one, leaving its tail in the
  // text as `[secret]_REAL_SECRET`. Replacing the longest match first cannot
  // be undone by a shorter one, because the characters are already gone.
  const byLengthDescending = [...secrets.comparable].sort(
    (left, right) => right.length - left.length
  );
  for (const secret of byLengthDescending) {
    if (secret.length === 0) continue;
    text = text.replace(caseInsensitivePattern(secret), REDACTED_SECRET);
  }
  // A `NextlyError`, not a bare one: this value is attached as the `cause` of
  // the error the wrapper throws, and everything constructed as an error in
  // this package is a `NextlyError`. Its sentence is the provider's own
  // diagnostic with the declared credentials taken out, which is what the
  // failure log is for -- the caller sees the OUTER error's message, never
  // this one.
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: text,
    logContext: { reason: "provider-diagnostic" },
  });
}

function normalizeProviderFailure(
  type: string,
  error: unknown,
  stage: "createAdapter" | "testConnection" | "send",
  secrets: DeclaredSecretValues
): unknown {
  // A provider that threw a `NextlyError` deliberately chose its own public
  // sentence and field paths; passing it through is the point. Containment is
  // applied to everything else, HERE rather than at the call sites, so a
  // contained cause can never be handed back into this check and mistaken for
  // that deliberate error.
  if (NextlyError.is(error)) return error;
  // Constructed rather than `NextlyError.internal()`, which fixes its own
  // public sentence: naming the provider is what tells an operator which of
  // several configured providers failed, and the type comes from the install's
  // own code rather than from a request.
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: `The "${type}" email provider failed. Check the server logs for the reason.`,
    cause: containedFailure(error, secrets),
    logContext: { providerType: type, stage },
  });
}

/**
 * Wrap a provider's callbacks so a credential cannot leave through one.
 *
 * `defineEmailProvider` applies this to what it builds, and the registry
 * applies it to everything it is handed. Both, because
 * `RegisteredEmailProvider` is a STRUCTURAL type: a JavaScript plugin or a
 * hand-built object reaches `register()` with its own `createAdapterFrom`, and
 * containment that lived only in the authoring helper would protect exactly the
 * authors least likely to need it.
 *
 * Applying it twice is harmless: `normalizeProviderFailure` passes a
 * `NextlyError` through unchanged, and a message id with no credential in it is
 * returned as it is. That is what makes enforcing at both ends safe.
 *
 * The secrets are read from the configuration this adapter was built FROM,
 * because the parsed form never leaves `createAdapterFrom` -- the erased
 * definition returns an adapter, not the value it parsed. The adapter can
 * therefore hold a credential in a shape this never saw, so the stored string
 * and its trimmed form are both compared and the comparison ignores case,
 * which covers the normalisations a credential field ordinarily receives.
 *
 * A parser that transforms a credential further -- encodes it, or derives a
 * token from it -- is outside what any comparison here can reach. Closing that
 * needs the parsed value, which is a change to the provider contract rather
 * than to this wrapper.
 */
export function containProviderCallbacks(
  provider: RegisteredEmailProvider
): RegisteredEmailProvider {
  const probe = provider.testConnectionFrom;

  return {
    ...provider,
    createAdapterFrom: (input: unknown): EmailProviderAdapter => {
      // Read BEFORE the callback runs. Building the adapter is itself a stage
      // that can throw a credential -- `createAdapter` receives the decrypted
      // configuration -- so containment cannot wait until after it succeeds.
      const secrets = declaredSecretValues(provider.configFields, input);

      let adapter: EmailProviderAdapter;
      try {
        adapter = provider.createAdapterFrom(input);
      } catch (error) {
        throw normalizeProviderFailure(
          provider.type,
          error,
          "createAdapter",
          secrets
        );
      }

      return {
        ...adapter,
        send: async options => {
          let result: EmailSendResult;
          try {
            result = await adapter.send(options);
          } catch (error) {
            throw normalizeProviderFailure(
              provider.type,
              error,
              "send",
              secrets
            );
          }
          return withoutLeakedSecrets(result, secrets);
        },
      };
    },
    ...(probe
      ? {
          testConnectionFrom: async (input: unknown) => {
            // The probe holds the decrypted configuration exactly as `send`
            // does, and `testProvider` writes its cause into the process log.
            const secrets = declaredSecretValues(provider.configFields, input);
            try {
              return await probe(input);
            } catch (error) {
              throw normalizeProviderFailure(
                provider.type,
                error,
                "testConnection",
                secrets
              );
            }
          },
        }
      : {}),
  };
}

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
