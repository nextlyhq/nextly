/**
 * Each provider key's linking and provisioning policy — the matrix, in one
 * place.
 *
 * Whether a key is enabled, whether it is trusted for implicit linking, and
 * whether it may provision, with which roles, all come from the app's own
 * auth configuration, which core reads itself. A login plugin hands core a
 * sign-in and never a policy: a plugin that could supply its own policy would
 * be the thing the policy exists to judge, so the reader's only input is the
 * app's configuration object and no sign-in payload is an argument anywhere
 * here — the shape of the API keeps plugin input out of the decision, and a
 * sign-in for a key the configuration doesn't enable is refused before any
 * lookup, which is what `requireEnabled` is for. It is a precondition, so it
 * runs first, whatever it costs.
 *
 * Every answer refuses unless the configuration turns it on. An app that
 * configures nothing refuses every key. Each row is parsed, from its own
 * fields alone, by one schema: `enabled` and `trustedForImplicitLinking`
 * switch on only for a literal `true`, and a row carrying anything else in
 * either of them is the refused row; a `provision` that is not an object
 * holding at least one non-empty role name leaves provisioning off and the
 * rest of the row standing. No default silently enables a branch. Trust
 * for implicit linking and permission to provision govern only those two
 * branches: an identity already linked signs in through a key that has
 * neither.
 *
 * Every object this reads — the providers map, a row, the nested
 * provision, a roles array's indices — is read by its OWN properties only.
 * A read by property name traverses the prototype chain when the object
 * lacks the key, so pollution on `Object.prototype` or `Array.prototype`
 * would otherwise speak as the app's configuration; a value a prototype
 * feeds in is never one.
 *
 * The matrix is a snapshot of the configuration as the app wrote it. The
 * boot resolves it once and the sign-in path asks it per key, so a later
 * edit to the app's configuration object — by a plugin's `setup`
 * transformer, say — cannot flip a key on between one sign-in and the next;
 * a config reload builds the policy afresh, as it rebuilds everything else.
 *
 * @module domains/auth/linking-policy
 */
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { isPlainObject } from "../../shared/lib/plain-copy";

/**
 * Whether a key may provision accounts, and with which roles.
 *
 * Off, or on with the configured set: there is no "on with no roles"
 * shorthand to misconfigure, because the roles ARE the switch — absent or
 * malformed reads as off, like every other answer here.
 */
export type ProviderProvisioningPolicy =
  | { readonly mayProvision: false }
  | { readonly mayProvision: true; readonly roles: readonly string[] };

/**
 * One provider key's row of the matrix, as core resolved it from the app's
 * configuration.
 *
 * `enabled` is the gate every sign-in passes; the other two fields govern
 * only their own branches and never a linked identity's sign-in.
 */
export interface ProviderKeyPolicy {
  /** Whether sign-ins through the key are accepted at all. */
  readonly enabled: boolean;
  /** Whether an unlinked identity may be linked to a matching account on a sign-in. */
  readonly trustedForImplicitLinking: boolean;
  /** Whether the key may provision accounts, and with which roles. */
  readonly provisioning: ProviderProvisioningPolicy;
}

/**
 * A provider key the configuration enables, with its branch answers.
 *
 * Returned only by `requireEnabled`, only for a key whose `enabled` is true,
 * so the branch answers ride a type that cannot exist for a refused key: a
 * caller cannot ask whether a disabled key may provision, because the gate
 * threw before the question was reachable.
 */
export interface EnabledProviderKey {
  /** The key, so a refusal or log line downstream can name it. */
  readonly providerKey: string;
  /** Whether an unlinked identity may be linked to a matching account on a sign-in. */
  readonly trustedForImplicitLinking: boolean;
  /** Whether the key may provision accounts, and with which roles. */
  readonly provisioning: ProviderProvisioningPolicy;
}

/**
 * What an app writes for one provider key, under `auth.providers`.
 *
 * Every field is optional and every field is off unless the configuration
 * turns it on: `enabled` only by `true`, implicit linking only by `true`,
 * provisioning only by a `provision` object carrying `roles` as an array of
 * role names. Anything else — absent, wrong type, wrong shape — reads as
 * off, so a malformed line can only refuse, never enable.
 */
export interface ProviderKeyPolicyConfig {
  /** Whether sign-ins through the key are accepted. Absent is disabled. */
  readonly enabled?: boolean;
  /**
   * Whether a sign-in may link an unlinked identity to a local account the
   * provider's proven address matches. Absent is not trusted.
   */
  readonly trustedForImplicitLinking?: boolean;
  /**
   * Whether the key may provision an account for an address no local account
   * holds, with the roles a provisioned account receives. Absent, or without
   * a `roles` array of at least one non-empty role name, provisions nothing:
   * an empty array is provisioning off, not zero-role provisioning, and an
   * empty string names no role.
   */
  readonly provision?: { readonly roles?: readonly string[] };
}

/**
 * The slice of an app's auth configuration the linking policy reads.
 *
 * Structural, so the policy declares the `providers` field it reads and
 * nothing about the rest of an app's auth configuration. `NextlyConfig`'s
 * `auth` section has no `providers` member yet, so an app's own auth object
 * does not satisfy this type as it is — until that wiring lands, a caller
 * passes the field's value, not the whole auth object.
 */
export interface LinkingPolicyAuthConfig {
  /** Each provider key's policy, keyed by the provider key as the app wrote it. */
  readonly providers?: Readonly<Record<string, ProviderKeyPolicyConfig>>;
}

/** The matrix, resolved from one app's auth configuration. */
export interface LinkingPolicy {
  /**
   * The row for one provider key, refused across the board where the
   * configuration names no policy for it.
   *
   * The non-throwing read: a caller that needs enabled-ness without signing
   * in — an unlink asking whether an identity's provider is still a way in,
   * say — asks this rather than passing a sign-in through the gate.
   */
  policyFor(providerKey: string): ProviderKeyPolicy;
  /**
   * The precondition every sign-in passes, before any lookup.
   *
   * Refuses, as `FORBIDDEN`, a key the configuration doesn't enable — one it
   * never names, or one it names without `enabled: true` — and returns the
   * key's branch answers only once the key is through the gate.
   */
  requireEnabled(providerKey: string): EnabledProviderKey;
}

/** Provisioning off, shared by every refused row. */
const NO_PROVISIONING: ProviderProvisioningPolicy = Object.freeze({
  mayProvision: false as const,
});

/**
 * The row for a key the configuration says nothing about: enabled by no one,
 * trusted by no one, provisioning nothing.
 */
const REFUSED_PROVIDER_KEY: ProviderKeyPolicy = Object.freeze({
  enabled: false,
  trustedForImplicitLinking: false,
  provisioning: NO_PROVISIONING,
});

/**
 * A roles array that owns every index it counts.
 *
 * zod's element parse reads by index, and an index a sparse array lacks is
 * found on `Array.prototype` when pollution puts one there — a hole stops
 * meaning "absent element" and starts meaning "inherited element". Only an
 * array whose indices are all OWN reaches the element parse, so a hole
 * refuses whatever the prototype carries.
 */
function ownsItsIndices(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

/**
 * Role names: at least one, each naming something, each index owned. An
 * empty string names no role, and one bad element refuses the whole
 * provision, as every malformed line here does.
 */
const roleNames = z.preprocess(
  value => (Array.isArray(value) && ownsItsIndices(value) ? value : undefined),
  z.array(z.string().min(1)).min(1)
);

/**
 * One provider key's row of the configuration, as the policy reads it.
 *
 * The configuration is outside input, parsed where it enters. `enabled` and
 * `trustedForImplicitLinking` admit only a literal `true`, absent allowed
 * and read as off, so a row carrying anything else in either gate field
 * fails the row — and a failed row is the refused row. Provisioning is
 * contained: a `provision` that is anything but an object holding a
 * `roles` array as `roleNames` accepts reads as off — an empty array, a
 * holey one, an empty-string name, or one holding a non-string — and
 * leaves the rest of the row standing. A malformed line can only refuse,
 * never enable.
 *
 * The nested `provision` object is stripped to its own fields before the
 * schema reads it, as the row itself is: a row owning `provision: {}`
 * would otherwise answer `roles` from a polluted prototype one level down.
 */
const providerKeyRowSchema = z.object({
  enabled: z.literal(true).optional(),
  trustedForImplicitLinking: z.literal(true).optional(),
  provision: z.preprocess(
    value => (isPlainObject(value) ? ownFieldsOf(value) : value),
    z.object({ roles: roleNames }).optional().catch(undefined)
  ),
});

/**
 * A row's own enumerable fields, as a fresh object no prototype feeds.
 *
 * The schema reads by property name, so an empty row could otherwise
 * answer from fields a polluted `Object.prototype` carries: an inherited
 * `enabled` would enable what nothing configured. Only own fields reach
 * zod, so an inherited field is never read on the way in.
 */
function ownFieldsOf(row: Record<string, unknown>): Record<string, unknown> {
  const own: Record<string, unknown> = Object.create(null);
  for (const [field, value] of Object.entries(row)) {
    own[field] = value;
  }
  return own;
}

/**
 * One configured entry's row: parsed by the schema above, so `true` alone
 * enables, as `allowRegistration` is sanitized, and provisioning is the
 * object's own question. A row that is not a plain object at all, or one
 * the schema refuses, is the refused row.
 */
function providerKeyPolicyOf(value: unknown): ProviderKeyPolicy {
  if (!isPlainObject(value)) return REFUSED_PROVIDER_KEY;
  const parsed = providerKeyRowSchema.safeParse(ownFieldsOf(value));
  if (!parsed.success) return REFUSED_PROVIDER_KEY;
  const data = parsed.data;
  // The parse's answers are read as OWN fields too: an absent optional
  // leaves no own key on zod's output, and a read of an absent key goes
  // through the prototype chain, where the same pollution waits even on
  // the fresh object zod built. A guarded read is undefined when absent,
  // never inherited.
  const ownAnswer = (field: keyof typeof data) =>
    Object.prototype.hasOwnProperty.call(data, field);
  const enabled = ownAnswer("enabled") && data.enabled === true;
  const trustedForImplicitLinking =
    ownAnswer("trustedForImplicitLinking") &&
    data.trustedForImplicitLinking === true;
  const provision = ownAnswer("provision") ? data.provision : undefined;
  return Object.freeze({
    enabled,
    trustedForImplicitLinking,
    // The roles are copied into a frozen array so the matrix holds its own
    // and the app's later edits reach nothing.
    provisioning: provision
      ? Object.freeze({
          mayProvision: true as const,
          roles: Object.freeze([...provision.roles]),
        })
      : NO_PROVISIONING,
  });
}

/**
 * The linking policy for one app, resolved once from its auth configuration.
 *
 * Takes the configuration as the app wrote it — core reads the app's own
 * auth configuration itself, here and nowhere else for this question — and
 * answers from the snapshot this builds, so nothing that mutates the app's
 * object afterwards moves an answer.
 */
export function linkingPolicyFromAuthConfig(
  auth: LinkingPolicyAuthConfig | undefined
): LinkingPolicy {
  // Own entries only, so a key named `constructor` or `__proto__` finds no
  // inherited object to resolve: it finds the refused row, like any other
  // key the app didn't write. The record has no prototype of its own,
  // because writing a `__proto__` key into a plain object literal sets its
  // prototype instead of adding an entry, and an app perverse enough to
  // define that key as a provider would corrupt the matrix rather than
  // configure it.
  const resolved: Record<string, ProviderKeyPolicy> = Object.create(null);
  // `providers` is read only when the app's auth object OWNS it: the read
  // traverses the prototype chain like any other, and a map a polluted
  // `Object.prototype` carries is not the app's configuration — an app
  // that configured nothing would come up enabled, trusted and
  // provisioning.
  const providers: unknown =
    auth !== undefined &&
    Object.prototype.hasOwnProperty.call(auth, "providers")
      ? auth.providers
      : undefined;
  if (isPlainObject(providers)) {
    for (const [key, value] of Object.entries(providers)) {
      resolved[key] = providerKeyPolicyOf(value);
    }
  }
  const matrix: Readonly<Record<string, ProviderKeyPolicy>> = resolved;

  // The one resolution both public questions derive from: whether the app
  // named the key at all, and the row it named (or the refused row).
  const rowFor = (
    providerKey: string
  ): { configured: boolean; policy: ProviderKeyPolicy } => {
    const configured = Object.prototype.hasOwnProperty.call(
      matrix,
      providerKey
    );
    return {
      configured,
      policy: configured ? matrix[providerKey] : REFUSED_PROVIDER_KEY,
    };
  };

  const policyFor = (providerKey: string): ProviderKeyPolicy =>
    rowFor(providerKey).policy;

  return Object.freeze({
    policyFor,
    requireEnabled(providerKey: string): EnabledProviderKey {
      const { configured, policy } = rowFor(providerKey);
      // The gate: refused here, before any lookup, for a key the
      // configuration doesn't name or doesn't enable. `logContext` names
      // which of the two it was for the operator; the person sees the
      // generic refusal and learns nothing about the app's configuration.
      if (!policy.enabled) {
        throw NextlyError.forbidden({
          logContext: {
            reason: configured
              ? "provider-key-not-enabled"
              : "provider-key-not-configured",
            providerKey,
          },
        });
      }
      return Object.freeze({
        providerKey,
        trustedForImplicitLinking: policy.trustedForImplicitLinking,
        provisioning: policy.provisioning,
      });
    },
  });
}
