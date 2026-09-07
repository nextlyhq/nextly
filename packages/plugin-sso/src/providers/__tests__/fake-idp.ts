import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
  type KeyObject,
} from "jose";

/**
 * A minimal OpenID provider, in-process.
 *
 * It exists so the adapter's verification path is exercised against real
 * signatures rather than a mocked `jwtVerify`. Mocking the verifier would leave
 * the one thing worth testing — that a bad token is actually rejected — asserted
 * only against our own stub, which cannot be wrong in the way a real one can.
 *
 * Routed by URL through a stubbed global `fetch`, because `createRemoteJWKSet`
 * fetches the key set itself and does not take the adapter's injected client.
 */
export const ISSUER = "https://idp.test";
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

export interface FakeIdpOptions {
  /**
   * Impersonate a specific provider.
   *
   * A real adapter hardcodes its provider's discovery URL — that value is not a
   * setting, and adding a production seam so a test can move it would be the
   * test changing the thing it is meant to observe. The fake answers on
   * whatever origin it is given instead.
   */
  issuer?: string;
  /** Omit fields from the discovery document, to test a provider that does. */
  discoveryOverrides?: Record<string, unknown>;
  /** Replace the whole document body, to test a malformed one. */
  discoveryBody?: string;
  discoveryStatus?: number;
  /** Make discovery throw rather than answer, as a network failure does. */
  discoveryThrows?: boolean;
  jwksStatus?: number;
  /**
   * Publish a SYMMETRIC key in the key set alongside the RSA one.
   *
   * Models a compromised or hostile JWKS. It is the only situation in which an
   * HMAC-signed ID token actually resolves a key — which makes it the only
   * situation that exercises the adapter's algorithm allowlist, rather than
   * jose's refusal to use an RSA public key as an HMAC secret.
   */
  publishSymmetricKey?: boolean;
  /** Token endpoint response body and status. */
  tokenResponse?: Record<string, unknown>;
  tokenStatus?: number;
}

export interface FakeIdp {
  issuer: string;
  discoveryUrl: string;
  /** Install as `globalThis.fetch`. */
  fetch: typeof fetch;
  /** Sign an ID token with the provider's real key. */
  signIdToken(
    claims: JWTPayload,
    opts?: { alg?: string; kid?: string }
  ): Promise<string>;
  /** Sign with a DIFFERENT key of the same algorithm — a valid token from elsewhere. */
  signWithForeignKey(claims: JWTPayload): Promise<string>;
  /** Sign HS256 with the symmetric key the key set publishes. */
  signSymmetric(claims: JWTPayload): Promise<string>;
  /** Every request the stub received, in order. */
  readonly calls: Array<{ url: string; method: string; body?: string }>;
  privateKey: KeyObject | CryptoKey;
}

export async function createFakeIdp(
  options: FakeIdpOptions = {}
): Promise<FakeIdp> {
  const issuer = options.issuer ?? ISSUER;
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const JWKS_URI = `${issuer}/jwks`;
  const TOKEN_ENDPOINT = `${issuer}/token`;
  const AUTHORIZATION_ENDPOINT = `${issuer}/authorize`;

  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const foreign = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const kid = "test-key-1";
  const symmetricSecret = new TextEncoder().encode(
    "a-published-symmetric-secret-32b"
  );
  const symmetricKid = "test-oct-1";
  const jwks = {
    keys: [
      { ...jwk, kid, alg: "RS256", use: "sig" },
      ...(options.publishSymmetricKey
        ? [
            {
              kty: "oct",
              kid: symmetricKid,
              alg: "HS256",
              use: "sig",
              k: Buffer.from(symmetricSecret).toString("base64url"),
            },
          ]
        : []),
    ],
  };

  const calls: Array<{ url: string; method: string; body?: string }> = [];

  const discovery: Record<string, unknown> = {
    issuer,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    jwks_uri: JWKS_URI,
    ...options.discoveryOverrides,
  };
  // An explicit `undefined` in the overrides means "omit this field", which is
  // how a provider that leaves one out is modelled.
  for (const [k, v] of Object.entries(discovery)) {
    if (v === undefined) delete discovery[k];
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? init.body : init?.body?.toString();
    calls.push({ url, method, ...(body !== undefined ? { body } : {}) });

    if (url === discoveryUrl) {
      if (options.discoveryThrows) throw new TypeError("network down");
      if (options.discoveryBody !== undefined) {
        return new Response(options.discoveryBody, {
          status: options.discoveryStatus ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
      return json(discovery, options.discoveryStatus ?? 200);
    }
    if (url === JWKS_URI) {
      if (options.jwksStatus && options.jwksStatus >= 400) {
        return json({ error: "nope" }, options.jwksStatus);
      }
      return json(jwks);
    }
    if (url === TOKEN_ENDPOINT) {
      return json(
        options.tokenResponse ?? { access_token: "at", token_type: "Bearer" },
        options.tokenStatus ?? 200
      );
    }
    throw new Error(`fake idp: unexpected request to ${url}`);
  }) as typeof fetch;

  return {
    issuer,
    discoveryUrl,
    fetch: fetchImpl,
    calls,
    privateKey,
    async signIdToken(claims, opts = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: opts.kid ?? kid })
        .sign(privateKey);
    },
    async signSymmetric(claims) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256", kid: symmetricKid })
        .sign(symmetricSecret);
    },
    async signWithForeignKey(claims) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid })
        .sign(foreign.privateKey);
    },
  };
}

/** Claims a conforming provider would issue, as a base for per-test edits. */
export function baseClaims(over: JWTPayload = {}): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: "client-id",
    sub: "subject-1",
    iat: now,
    exp: now + 300,
    nonce: "nonce-1",
    email: "person@example.com",
    email_verified: true,
    name: "A Person",
    ...over,
  };
}
