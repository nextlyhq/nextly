/**
 * The provider keys this plugin ships adapters for.
 *
 * A closed union rather than an open string: every key here has a hand-written
 * adapter behind it, and a typo in a config should fail at the type level
 * rather than at the first login attempt.
 */
export type ProviderKey = "google" | "microsoft" | "github";

/** Options shared by every provider. */
interface BaseProviderOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Extra scopes appended to the adapter's defaults. The defaults already cover
   * identity; this is for a deployment that needs more from the same consent.
   */
  extraScopes?: string[];
}

export interface GoogleProviderOptions extends BaseProviderOptions {
  /**
   * Google Workspace domains permitted to sign in, matched against the `hd`
   * claim. Empty or absent means any Google account, which for most
   * deployments is broader than intended.
   */
  hostedDomains?: string[];
}

export interface MicrosoftProviderOptions extends BaseProviderOptions {
  /**
   * The authority tenant: a tenant GUID, a verified domain, or one of
   * `common` / `organizations` / `consumers`. Defaults to `common`.
   */
  tenant?: string;
  /**
   * Tenant GUIDs permitted to sign in, matched against the `tid` claim.
   *
   * Required whenever `tenant` is multi-tenant. On `common` the issuer is
   * per-tenant, so validating `iss` proves only that some Microsoft tenant
   * signed the token — without a `tid` allowlist every Entra account in the
   * world satisfies the check.
   */
  allowedTenantIds?: string[];
}

export interface GitHubProviderOptions extends BaseProviderOptions {
  /**
   * GitHub organisations a user must belong to. Empty or absent means any
   * GitHub account.
   */
  allowedOrgs?: string[];
}

export interface SsoOptions {
  /**
   * Absolute public origin of this deployment, e.g. `https://cms.acme.com`.
   *
   * Configured rather than derived from the incoming request: the redirect URI
   * must match what is registered at the provider byte for byte, and a value
   * read from `Host` or `X-Forwarded-Host` is attacker-controlled. Deriving it
   * would let a spoofed header send the authorization code somewhere else.
   */
  baseUrl: string;
  /** Providers to enable. At least one is required. */
  providers: {
    google?: GoogleProviderOptions;
    microsoft?: MicrosoftProviderOptions;
    github?: GitHubProviderOptions;
  };
  /**
   * Create a local user on first successful provider login.
   *
   * Off by default. On, anyone the provider will authenticate can obtain an
   * account, which for a public provider such as Google or GitHub means anyone
   * at all unless a domain or organisation allowlist narrows it.
   */
  autoProvision?: boolean;
  /** Role slug granted to auto-provisioned users. Required when `autoProvision` is on. */
  defaultRoleSlug?: string;
  /**
   * Attach a provider identity to an existing local account when the provider
   * asserts the same, verified, email address. Defaults to on.
   *
   * Only ever on a verified assertion. Linking on an unverified email lets
   * anyone who can register that address at the provider take over the local
   * account that holds it.
   */
  allowLinkByVerifiedEmail?: boolean;
}

/** Options with defaults applied. */
export interface ResolvedSsoOptions extends SsoOptions {
  autoProvision: boolean;
  allowLinkByVerifiedEmail: boolean;
  enabledProviders: ProviderKey[];
}

/** Thrown when the plugin is configured in a way that cannot work or cannot be safe. */
export class SsoConfigError extends Error {
  constructor(message: string) {
    super(`@nextlyhq/plugin-sso: ${message}`);
    this.name = "SsoConfigError";
  }
}

/** Tenants whose issuer does not identify a single organisation. */
const MULTI_TENANT_AUTHORITIES = new Set(["common", "organizations"]);

/**
 * Reduce `baseUrl` to a bare origin, rejecting anything that cannot serve as
 * one half of a redirect URI.
 *
 * A path here would be silently concatenated into every redirect URI, which the
 * provider then rejects at the token exchange with an error naming neither
 * value — so it is refused where it can still be named.
 */
function normalizeBaseUrl(baseUrl: string): string {
  let origin: string;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SsoConfigError(
        `baseUrl must be http or https, received "${url.protocol}"`
      );
    }
    origin = url.origin;
  } catch (err) {
    if (err instanceof SsoConfigError) throw err;
    throw new SsoConfigError(
      `baseUrl must be an absolute URL, received "${baseUrl}"`
    );
  }
  if (origin !== baseUrl.replace(/\/+$/, "")) {
    throw new SsoConfigError(
      `baseUrl must be a bare origin with no path, received "${baseUrl}"`
    );
  }
  return origin;
}

/** The providers actually configured, in declaration order. */
function collectEnabledProviders(
  providers: SsoOptions["providers"]
): ProviderKey[] {
  const keys = (Object.keys(providers) as ProviderKey[]).filter(
    key => providers[key] !== undefined
  );
  if (keys.length === 0) {
    throw new SsoConfigError("at least one provider must be configured");
  }
  return keys;
}

/** Every enabled provider needs a client pair; an empty one cannot authenticate. */
function assertCredentials(
  providers: SsoOptions["providers"],
  enabled: ProviderKey[]
): void {
  for (const key of enabled) {
    const provider = providers[key];
    if (!provider?.clientId) {
      throw new SsoConfigError(`providers.${key}.clientId is required`);
    }
    if (!provider.clientSecret) {
      throw new SsoConfigError(`providers.${key}.clientSecret is required`);
    }
  }
}

/**
 * A multi-tenant Entra authority must name the tenants it trusts.
 *
 * On `common` or `organizations` the issuer is per-tenant, so validating `iss`
 * proves only that SOME Microsoft tenant signed the token. Without an
 * allowlist every Entra account in the world satisfies the check, and no
 * runtime validation can recover the distinction — so the configuration is
 * refused rather than accepted and policed later.
 */
function assertMicrosoftTenant(microsoft?: MicrosoftProviderOptions): void {
  if (!microsoft) return;
  const tenant = microsoft.tenant ?? "common";
  if (!MULTI_TENANT_AUTHORITIES.has(tenant)) return;
  if ((microsoft.allowedTenantIds?.length ?? 0) > 0) return;
  throw new SsoConfigError(
    `providers.microsoft.allowedTenantIds is required when tenant is "${tenant}": ` +
      "a multi-tenant authority issues tokens for every Entra tenant, so without " +
      "an allowlist any Microsoft account in the world can sign in"
  );
}

/** Provisioning has to know what to grant, or it grants whatever the default is. */
function assertProvisioning(
  autoProvision: boolean,
  defaultRoleSlug?: string
): void {
  if (autoProvision && !defaultRoleSlug) {
    throw new SsoConfigError(
      "defaultRoleSlug is required when autoProvision is enabled"
    );
  }
}

/**
 * Validate options and apply defaults.
 *
 * Every check fails at boot rather than at a login. A misconfiguration that
 * surfaces on the first sign-in attempt surfaces as a failed login, which reads
 * as a credential problem and gets debugged as one; the same fact stated while
 * the process is starting names itself.
 */
export function resolveSsoOptions(options: SsoOptions): ResolvedSsoOptions {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const enabledProviders = collectEnabledProviders(options.providers);
  assertCredentials(options.providers, enabledProviders);
  assertMicrosoftTenant(options.providers.microsoft);

  const autoProvision = options.autoProvision ?? false;
  assertProvisioning(autoProvision, options.defaultRoleSlug);

  return {
    ...options,
    baseUrl,
    autoProvision,
    allowLinkByVerifiedEmail: options.allowLinkByVerifiedEmail ?? true,
    enabledProviders,
  };
}

/** The package name, which is also the namespace this plugin's routes are served under. */
export const PLUGIN_NAME = "@nextlyhq/plugin-sso";

/**
 * The absolute redirect URI for a provider — the value to register in its
 * console.
 *
 * Built here rather than spelled out per adapter so the authorize request, the
 * token exchange and the documentation cannot disagree; a token exchange whose
 * `redirect_uri` differs by one character from the authorize request is
 * rejected by every conforming provider, with an error that names neither
 * value.
 *
 * The `/admin/api` prefix is where the host mounts the Nextly request handler,
 * and `/plugins/<package name>` is the namespace the route registry serves a
 * plugin's routes under.
 */
export function redirectUri(baseUrl: string, provider: ProviderKey): string {
  return `${baseUrl}/admin/api/plugins/${PLUGIN_NAME}/callback/${provider}`;
}
