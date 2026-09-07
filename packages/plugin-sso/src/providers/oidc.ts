import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { ProviderKey } from "../config";
import { SsoError } from "../errors";

import type {
  AuthorizeArgs,
  ExchangeArgs,
  ExternalProfile,
  ProviderAdapter,
  TokenSet,
} from "./types";

/**
 * The discovery fields this adapter reads.
 *
 * A provider's document carries far more; naming only what is used keeps the
 * failure mode honest — a missing field here is a provider that cannot be
 * driven, rather than a provider that merely omitted something optional.
 */
export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

/**
 * Signature algorithms accepted on an ID token.
 *
 * Asymmetric only, and pinned rather than read from the discovery document — a
 * compromised document could simply widen its own allowlist.
 *
 * Honest about what this does and does not buy, because break-verification
 * measured it: with this option REMOVED, no test changes. `createRemoteJWKSet`
 * resolves only asymmetric keys, so an HMAC-signed token finds no key to verify
 * against whatever the allowlist says, and every other algorithm the published
 * RSA key supports needs the private half — at which point the attacker can
 * sign `RS256` anyway. The classic HS-vs-RS confusion is closed by jose's key
 * resolution here, not by this constant.
 *
 * It is kept as a second line rather than deleted: it costs nothing, it states
 * the intent at the call site, and it is what stops a later change of key
 * source — a local secret, a static JWK, a different library — from silently
 * reopening the case. That is a real risk and an unprovable one today, so the
 * pin stays and the test suite does not pretend to cover it.
 */
const ALLOWED_ID_TOKEN_ALGS = ["RS256", "ES256"] as const;

/** How long a discovery document is reused before being refetched. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/** Tolerated clock skew between us and the provider, in seconds. */
const CLOCK_TOLERANCE_S = 30;

/**
 * Remembers discovery documents and their JWKS resolvers.
 *
 * Injectable rather than a bare module-level map so a test can hold its own and
 * stay independent of execution order. Production passes nothing and shares the
 * module default, which is what makes the JWKS resolver worth caching at all:
 * `createRemoteJWKSet` keeps its own key cache and refetch cooldown, and a
 * fresh one per request would discard both and hammer the provider on every
 * sign-in.
 */
export class DiscoveryCache {
  private readonly entries = new Map<
    string,
    {
      doc: DiscoveryDocument;
      jwks: ReturnType<typeof createRemoteJWKSet>;
      expiresAt: number;
    }
  >();

  get(
    url: string
  ): {
    doc: DiscoveryDocument;
    jwks: ReturnType<typeof createRemoteJWKSet>;
  } | null {
    const hit = this.entries.get(url);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(url);
      return null;
    }
    return { doc: hit.doc, jwks: hit.jwks };
  }

  set(
    url: string,
    doc: DiscoveryDocument,
    jwks: ReturnType<typeof createRemoteJWKSet>,
    ttlMs: number = DISCOVERY_TTL_MS
  ): void {
    this.entries.set(url, { doc, jwks, expiresAt: Date.now() + ttlMs });
  }

  /** Drop everything. Test seam; never called at runtime. */
  clear(): void {
    this.entries.clear();
  }
}

const defaultCache = new DiscoveryCache();

/** Drop the shared discovery cache. Exposed for tests, which need isolation. */
export function resetDiscoveryCache(): void {
  defaultCache.clear();
}

/**
 * Decide whether a token's `iss` belongs to the provider we configured.
 *
 * Pluggable because exact equality is wrong for at least one real provider: a
 * multi-tenant Entra authority publishes its issuer as a literal
 * `https://login.microsoftonline.com/{tenantid}/v2.0` template, so a token's
 * concrete issuer never equals the discovered string. An adapter that needs to
 * resolve the template supplies its own.
 *
 * Returning a boolean rather than throwing keeps the failure wording in one
 * place — the caller raises `id-token-invalid` with the same detail shape
 * whichever check rejected.
 */
export type IssuerValidator = (args: {
  discovered: string;
  actual: string;
  claims: JWTPayload;
}) => boolean;

const exactIssuer: IssuerValidator = ({ discovered, actual }) =>
  discovered === actual;

export interface OidcAdapterOptions {
  key: ProviderKey;
  /** Absolute URL of the OpenID configuration document. */
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  /** Extra authorization-request parameters, e.g. Google's `hd`. */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * Reduce verified claims to a profile. Provider-specific: which claim is the
   * stable subject, and where the email comes from.
   */
  claimsToProfile: (claims: JWTPayload) => ExternalProfile;
  /**
   * Provider-specific claim assertions beyond signature and audience — a tenant
   * allowlist, a hosted-domain allowlist. Throws {@link SsoError} to reject.
   */
  assertClaims?: (claims: JWTPayload) => void;
  validateIssuer?: IssuerValidator;
  cache?: DiscoveryCache;
  /** Injected for tests; production uses the global. */
  fetchImpl?: typeof fetch;
}

/** Fetch and cache the discovery document plus its JWKS resolver. */
async function discover(
  opts: OidcAdapterOptions
): Promise<{
  doc: DiscoveryDocument;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}> {
  const cache = opts.cache ?? defaultCache;
  const cached = cache.get(opts.discoveryUrl);
  if (cached) return cached;

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.discoveryUrl, {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    // Fail closed. Serving a document past its TTL would let a provider's
    // outage be papered over with configuration that may since have changed —
    // including a rotated JWKS URI, which is the one field where being stale is
    // a signature-verification problem rather than an inconvenience.
    throw new SsoError(
      "discovery-unavailable",
      `${opts.discoveryUrl}: ${err instanceof Error ? err.message : "fetch failed"}`
    );
  }
  if (!res.ok) {
    throw new SsoError(
      "discovery-unavailable",
      `${opts.discoveryUrl}: HTTP ${res.status}`
    );
  }

  let doc: DiscoveryDocument;
  try {
    doc = (await res.json()) as DiscoveryDocument;
  } catch {
    throw new SsoError(
      "discovery-unavailable",
      `${opts.discoveryUrl}: malformed JSON`
    );
  }

  for (const field of [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ] as const) {
    if (typeof doc[field] !== "string" || doc[field].length === 0) {
      throw new SsoError(
        "discovery-unavailable",
        `${opts.discoveryUrl}: missing ${field}`
      );
    }
  }

  // The resolver handles `kid` rotation and its own refetch cooldown, so it is
  // cached alongside the document rather than rebuilt per request.
  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri), {
    cacheMaxAge: DISCOVERY_TTL_MS,
    cooldownDuration: 30_000,
  });

  cache.set(opts.discoveryUrl, doc, jwks);
  return { doc, jwks };
}

/**
 * Build an adapter for any provider that speaks OpenID Connect.
 *
 * Google and Microsoft are both configuration over this function, and so is any
 * customer-operated IdP — Okta, Auth0, Keycloak, Ping. GitHub is not, which is
 * why it has its own adapter rather than an option here.
 */
export function createOidcAdapter(opts: OidcAdapterOptions): ProviderAdapter {
  const validateIssuer = opts.validateIssuer ?? exactIssuer;

  return {
    key: opts.key,
    scopes: opts.scopes,

    async buildAuthorizeUrl(args: AuthorizeArgs): Promise<string> {
      const { doc } = await discover(opts);
      const url = new URL(doc.authorization_endpoint);
      url.searchParams.set("client_id", opts.clientId);
      url.searchParams.set("redirect_uri", args.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", opts.scopes.join(" "));
      url.searchParams.set("state", args.state);
      url.searchParams.set("nonce", args.nonce);
      url.searchParams.set("code_challenge", args.challenge);
      // Never read from `code_challenge_methods_supported`: some Entra
      // endpoints omit the field entirely, and a client that infers support
      // from it falls back to `plain` — which is the verifier itself, so an
      // attacker who can read the authorization request can replay the code.
      url.searchParams.set("code_challenge_method", "S256");
      // The provider must return through a top-level GET. Core's session and
      // transaction cookies are `SameSite=Lax`, which a cross-site form POST
      // does not carry, so `form_post` would arrive with no transaction to
      // match against and read as a state mismatch.
      url.searchParams.set("response_mode", "query");
      for (const [k, v] of Object.entries(opts.extraAuthorizeParams ?? {})) {
        url.searchParams.set(k, v);
      }
      return url.toString();
    },

    async exchange(args: ExchangeArgs): Promise<TokenSet> {
      const { doc } = await discover(opts);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        // Byte-identical to the authorize request. A conforming provider
        // rejects any difference, with an error naming neither value.
        redirect_uri: args.redirectUri,
        code_verifier: args.verifier,
        client_id: opts.clientId,
      });

      // `client_secret_post` unless the provider says it only takes Basic. All
      // three first-party targets accept POST, but a customer's own IdP behind
      // this same adapter may not, so the advertised methods decide.
      const methods = doc.token_endpoint_auth_methods_supported;
      const useBasic =
        Array.isArray(methods) &&
        !methods.includes("client_secret_post") &&
        methods.includes("client_secret_basic");

      const headers: Record<string, string> = {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      };
      if (useBasic) {
        const credentials = `${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`;
        headers.authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
      } else {
        body.set("client_secret", opts.clientSecret);
      }

      const doFetch = opts.fetchImpl ?? fetch;
      let res: Response;
      try {
        res = await doFetch(doc.token_endpoint, {
          method: "POST",
          headers,
          body,
        });
      } catch (err) {
        throw new SsoError(
          "token-exchange-failed",
          err instanceof Error ? err.message : "fetch failed"
        );
      }

      let payload: Record<string, unknown>;
      try {
        payload = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new SsoError(
          "token-exchange-failed",
          `HTTP ${res.status}, malformed JSON`
        );
      }
      if (!res.ok) {
        // The provider's own error code is operator detail, never public: it
        // can name an account state.
        const code =
          typeof payload.error === "string"
            ? payload.error
            : `HTTP ${res.status}`;
        throw new SsoError("token-exchange-failed", code);
      }
      if (typeof payload.access_token !== "string") {
        throw new SsoError(
          "token-exchange-failed",
          "no access_token in response"
        );
      }

      const tokens: TokenSet = { accessToken: payload.access_token };
      if (typeof payload.id_token === "string")
        tokens.idToken = payload.id_token;
      if (typeof payload.token_type === "string")
        tokens.tokenType = payload.token_type;
      if (typeof payload.expires_in === "number")
        tokens.expiresIn = payload.expires_in;
      if (typeof payload.scope === "string") tokens.scope = payload.scope;
      return tokens;
    },

    async toProfile(
      tokens: TokenSet,
      args: { nonce: string }
    ): Promise<ExternalProfile> {
      if (!tokens.idToken) {
        throw new SsoError("id-token-invalid", "provider returned no id_token");
      }
      const { doc, jwks } = await discover(opts);

      let claims: JWTPayload;
      try {
        const result = await jwtVerify(tokens.idToken, jwks, {
          audience: opts.clientId,
          algorithms: [...ALLOWED_ID_TOKEN_ALGS],
          clockTolerance: CLOCK_TOLERANCE_S,
        });
        claims = result.payload;
      } catch (err) {
        throw new SsoError(
          "id-token-invalid",
          err instanceof Error ? err.message : "verification failed"
        );
      }

      // `jwtVerify` bounds `exp` and `nbf`, but only inspects `iat` when
      // `maxTokenAge` is set — so a token stamped in the future passes every
      // check it applies. That is worth rejecting on its own: it is either a
      // clock far enough out that the rest of the flow's timing cannot be
      // trusted, or a token minted to outlive its window.
      if (
        typeof claims.iat === "number" &&
        claims.iat > Date.now() / 1000 + CLOCK_TOLERANCE_S
      ) {
        throw new SsoError("id-token-invalid", "iat is in the future");
      }

      // Issuer is checked here rather than through jwtVerify's `issuer` option
      // because the comparison is not always equality — see IssuerValidator.
      if (
        typeof claims.iss !== "string" ||
        !validateIssuer({ discovered: doc.issuer, actual: claims.iss, claims })
      ) {
        throw new SsoError(
          "id-token-invalid",
          `issuer ${String(claims.iss)} not accepted`
        );
      }

      // After signature verification, never before: an unverified token's
      // claims are attacker-supplied, so comparing the nonce first would be
      // comparing against nothing.
      if (claims.nonce !== args.nonce) {
        throw new SsoError("id-token-invalid", "nonce mismatch");
      }

      opts.assertClaims?.(claims);
      return opts.claimsToProfile(claims);
    },
  };
}
