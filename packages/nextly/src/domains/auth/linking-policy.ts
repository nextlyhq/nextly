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
 * configures nothing refuses every key; a field that is absent, or present
 * with anything but the shape that switches it on, reads as off, so no
 * default silently enables a branch. Trust for implicit linking and
 * permission to provision govern only those two branches: an identity
 * already linked signs in through a key that has neither.
 *
 * The matrix is a snapshot of the configuration as the app wrote it. The
 * boot resolves it once and the sign-in path asks it per key, so a later
 * edit to the app's configuration object — by a plugin's `setup`
 * transformer, say — cannot flip a key on between one sign-in and the next;
 * a config reload builds the policy afresh, as it rebuilds everything else.
 *
 * @module domains/auth/linking-policy
 */
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
   * a `roles` array of role names, provisions nothing.
   */
  readonly provision?: { readonly roles?: readonly string[] };
}

/**
 * The slice of an app's auth configuration the linking policy reads.
 *
 * Structural, so the app's own auth object is assignable as it is and the
 * policy declares nothing about the rest of it.
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
 * One configured entry's provisioning, or off.
 *
 * Only a plain object carrying `roles` as an array of strings switches
 * provisioning on; the roles are copied into a frozen array so the matrix
 * holds its own and the app's later edits reach nothing.
 */
function provisioningOf(value: unknown): ProviderProvisioningPolicy {
  if (!isPlainObject(value)) return NO_PROVISIONING;
  const roles: unknown = value.roles;
  // A roles array with a non-string in it is a malformed line, and a
  // malformed line provisions nothing rather than the entries that parsed.
  if (!Array.isArray(roles) || roles.some(role => typeof role !== "string")) {
    return NO_PROVISIONING;
  }
  return Object.freeze({
    mayProvision: true as const,
    roles: Object.freeze([...roles]) as readonly string[],
  });
}

/**
 * One configured entry's row: `true` alone enables, as `allowRegistration`
 * is sanitized, and provisioning is the object's own question.
 */
function providerKeyPolicyOf(value: unknown): ProviderKeyPolicy {
  if (!isPlainObject(value)) return REFUSED_PROVIDER_KEY;
  return Object.freeze({
    enabled: value.enabled === true,
    trustedForImplicitLinking: value.trustedForImplicitLinking === true,
    provisioning: provisioningOf(value.provision),
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
  const providers: unknown = auth?.providers;
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
