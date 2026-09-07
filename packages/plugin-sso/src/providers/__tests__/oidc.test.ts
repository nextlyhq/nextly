import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SsoError } from "../../errors";
import {
  createOidcAdapter,
  DiscoveryCache,
  type OidcAdapterOptions,
} from "../oidc";
import type { ExternalProfile } from "../types";

import {
  baseClaims,
  createFakeIdp,
  DISCOVERY_URL,
  ISSUER,
  type FakeIdp,
} from "./fake-idp";

const CLIENT_ID = "client-id";

function profileFromClaims(claims: Record<string, unknown>): ExternalProfile {
  return {
    providerAccountId: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : null,
    image: null,
  };
}

function adapterFor(idp: FakeIdp, over: Partial<OidcAdapterOptions> = {}) {
  return createOidcAdapter({
    key: "google",
    discoveryUrl: DISCOVERY_URL,
    clientId: CLIENT_ID,
    clientSecret: "client-secret",
    scopes: ["openid", "email"],
    claimsToProfile: profileFromClaims,
    // A cache per adapter, so no test can be affected by another's discovery.
    cache: new DiscoveryCache(),
    ...over,
  });
}

let idp: FakeIdp;

async function install(options = {}) {
  idp = await createFakeIdp(options);
  vi.stubGlobal("fetch", idp.fetch);
  return idp;
}

beforeEach(async () => {
  await install();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discovery", () => {
  it("fetches the document once and reuses it", async () => {
    const adapter = adapterFor(idp);
    await adapter.buildAuthorizeUrl({
      state: "s",
      nonce: "n",
      challenge: "c",
      redirectUri: "https://app.test/cb",
    });
    await adapter.buildAuthorizeUrl({
      state: "s2",
      nonce: "n2",
      challenge: "c2",
      redirectUri: "https://app.test/cb",
    });
    const discoveryCalls = idp.calls.filter(c => c.url === DISCOVERY_URL);
    expect(discoveryCalls).toHaveLength(1);
  });

  it("fails closed when the document cannot be fetched", async () => {
    await install({ discoveryThrows: true });
    const adapter = adapterFor(idp);
    await expect(
      adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    ).rejects.toMatchObject({ reason: "discovery-unavailable" });
  });

  it("fails closed on a non-200", async () => {
    await install({ discoveryStatus: 503 });
    const adapter = adapterFor(idp);
    await expect(
      adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    ).rejects.toMatchObject({ reason: "discovery-unavailable" });
  });

  it("rejects a malformed document", async () => {
    await install({ discoveryBody: "not json at all" });
    const adapter = adapterFor(idp);
    await expect(
      adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    ).rejects.toThrow(/malformed JSON/);
  });

  it.each(["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"])(
    "rejects a document missing %s",
    async field => {
      await install({ discoveryOverrides: { [field]: undefined } });
      const adapter = adapterFor(idp);
      await expect(
        adapter.buildAuthorizeUrl({
          state: "s",
          nonce: "n",
          challenge: "c",
          redirectUri: "r",
        })
      ).rejects.toThrow(new RegExp(`missing ${field}`));
    }
  );
});

describe("buildAuthorizeUrl", () => {
  it("carries every parameter the flow depends on", async () => {
    const adapter = adapterFor(idp);
    const url = new URL(
      await adapter.buildAuthorizeUrl({
        state: "the-state",
        nonce: "the-nonce",
        challenge: "the-challenge",
        redirectUri: "https://app.test/cb",
      })
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("nonce")).toBe("the-nonce");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
  });

  /**
   * Some Entra endpoints omit `code_challenge_methods_supported`. A client that
   * infers support from it falls back to `plain`, whose challenge IS the
   * verifier — so anyone who can read the authorization request can replay the
   * code. The method is therefore pinned, not negotiated.
   */
  it("sends S256 even when the document advertises no PKCE support", async () => {
    await install({
      discoveryOverrides: { code_challenge_methods_supported: undefined },
    });
    const adapter = adapterFor(idp);
    const url = new URL(
      await adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  /** SameSite=Lax cookies do not survive a cross-site form POST back. */
  it("always requests response_mode=query", async () => {
    const adapter = adapterFor(idp);
    const url = new URL(
      await adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    );
    expect(url.searchParams.get("response_mode")).toBe("query");
  });

  it("appends provider-specific parameters", async () => {
    const adapter = adapterFor(idp, {
      extraAuthorizeParams: { hd: "acme.com" },
    });
    const url = new URL(
      await adapter.buildAuthorizeUrl({
        state: "s",
        nonce: "n",
        challenge: "c",
        redirectUri: "r",
      })
    );
    expect(url.searchParams.get("hd")).toBe("acme.com");
  });
});

describe("exchange", () => {
  it("posts the grant with the verifier and an exact redirect_uri", async () => {
    const adapter = adapterFor(idp);
    await adapter.exchange({
      code: "the-code",
      verifier: "the-verifier",
      redirectUri: "https://app.test/cb",
    });
    const call = idp.calls.find(c => c.method === "POST");
    const body = new URLSearchParams(call?.body ?? "");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("redirect_uri")).toBe("https://app.test/cb");
    expect(body.get("client_secret")).toBe("client-secret");
  });

  it("uses Basic auth when the provider does not advertise client_secret_post", async () => {
    await install({
      discoveryOverrides: {
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      },
    });
    const adapter = adapterFor(idp);
    await adapter.exchange({ code: "c", verifier: "v", redirectUri: "r" });
    const call = idp.calls.find(c => c.method === "POST");
    expect(
      new URLSearchParams(call?.body ?? "").get("client_secret")
    ).toBeNull();
  });

  it("returns the token set", async () => {
    await install({
      tokenResponse: {
        access_token: "at",
        id_token: "it",
        token_type: "Bearer",
        expires_in: 3600,
      },
    });
    const adapter = adapterFor(idp);
    await expect(
      adapter.exchange({ code: "c", verifier: "v", redirectUri: "r" })
    ).resolves.toEqual({
      accessToken: "at",
      idToken: "it",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
  });

  it("surfaces a provider error as a typed failure", async () => {
    await install({
      tokenStatus: 400,
      tokenResponse: { error: "invalid_grant" },
    });
    const adapter = adapterFor(idp);
    await expect(
      adapter.exchange({ code: "c", verifier: "v", redirectUri: "r" })
    ).rejects.toMatchObject({
      reason: "token-exchange-failed",
      detail: "invalid_grant",
    });
  });

  it("rejects a 200 with no access_token", async () => {
    await install({ tokenResponse: { token_type: "Bearer" } });
    const adapter = adapterFor(idp);
    await expect(
      adapter.exchange({ code: "c", verifier: "v", redirectUri: "r" })
    ).rejects.toThrow(/no access_token/);
  });
});

describe("toProfile — ID token verification", () => {
  async function profile(claims: Record<string, unknown>, nonce = "nonce-1") {
    const adapter = adapterFor(idp);
    const idToken = await idp.signIdToken(claims);
    return adapter.toProfile({ accessToken: "at", idToken }, { nonce });
  }

  it("accepts a conforming token", async () => {
    await expect(profile(baseClaims())).resolves.toMatchObject({
      providerAccountId: "subject-1",
      email: "person@example.com",
      emailVerified: true,
    });
  });

  it("rejects a token with no id_token at all", async () => {
    const adapter = adapterFor(idp);
    await expect(
      adapter.toProfile({ accessToken: "at" }, { nonce: "n" })
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  it("rejects a token minted for a different audience", async () => {
    await expect(
      profile(baseClaims({ aud: "someone-else" }))
    ).rejects.toBeInstanceOf(SsoError);
  });

  it("rejects a token from a different issuer", async () => {
    await expect(
      profile(baseClaims({ iss: "https://evil.test" }))
    ).rejects.toThrow(/not accepted/);
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      profile(baseClaims({ iat: past, exp: past + 60 }))
    ).rejects.toBeInstanceOf(SsoError);
  });

  /**
   * `jwtVerify` bounds `exp` and `nbf` but only inspects `iat` when
   * `maxTokenAge` is set, so this is checked by the adapter rather than
   * inherited from the library.
   */
  it("rejects a token stamped in the future", async () => {
    const ahead = Math.floor(Date.now() / 1000) + 3600;
    await expect(
      profile(baseClaims({ iat: ahead, exp: ahead + 300 }))
    ).rejects.toThrow(/iat is in the future/);
  });

  it("rejects a token whose nonce belongs to another transaction", async () => {
    await expect(
      profile(baseClaims({ nonce: "someone-elses" }))
    ).rejects.toThrow(/nonce mismatch/);
  });

  it("rejects a token carrying no nonce", async () => {
    const claims = baseClaims();
    delete claims.nonce;
    await expect(profile(claims)).rejects.toThrow(/nonce mismatch/);
  });

  it("rejects an unsigned token", async () => {
    const adapter = adapterFor(idp);
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" })
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(baseClaims())).toString(
      "base64url"
    );
    await expect(
      adapter.toProfile(
        { accessToken: "at", idToken: `${header}.${payload}.` },
        { nonce: "nonce-1" }
      )
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  /**
   * The alg-confusion path: a token HMAC'd with the provider's PUBLIC key,
   * which is published. Rejected because the accepted algorithms are pinned to
   * asymmetric ones rather than read from the token's own header.
   */
  it("rejects an HS256 token offered against an RSA key set", async () => {
    const adapter = adapterFor(idp);
    const forged = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("public-key-material"));
    await expect(
      adapter.toProfile(
        { accessToken: "at", idToken: forged },
        { nonce: "nonce-1" }
      )
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  /**
   * Documents a composite behaviour, and says so rather than claiming to cover
   * our algorithm pin — which it does not.
   *
   * Break-verification removed `algorithms` from the verify call and no test
   * moved, including this one: `createRemoteJWKSet` resolves only asymmetric
   * keys, so the symmetric entry below is never returned and the HMAC token
   * finds nothing to verify against. The refusal is jose's key resolution, not
   * our allowlist.
   *
   * Worth keeping anyway. The property it pins down — a hostile or compromised
   * key set cannot mint an accepted identity by publishing a secret — is one
   * someone will otherwise assume, and a library upgrade that relaxed it would
   * fail here.
   */
  it("rejects an HMAC token even when the key set publishes a symmetric key", async () => {
    await install({ publishSymmetricKey: true });
    const adapter = adapterFor(idp);
    const forged = await idp.signSymmetric(baseClaims());
    await expect(
      adapter.toProfile(
        { accessToken: "at", idToken: forged },
        { nonce: "nonce-1" }
      )
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  it("rejects a validly-signed token from a different key", async () => {
    const adapter = adapterFor(idp);
    const foreign = await idp.signWithForeignKey(baseClaims());
    await expect(
      adapter.toProfile(
        { accessToken: "at", idToken: foreign },
        { nonce: "nonce-1" }
      )
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  it("fails typed when the key set cannot be fetched", async () => {
    await install({ jwksStatus: 500 });
    const adapter = adapterFor(idp);
    const idToken = await idp.signIdToken(baseClaims());
    await expect(
      adapter.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });
});

describe("issuer validation is pluggable", () => {
  /**
   * A multi-tenant Entra authority publishes its issuer as a literal
   * `{tenantid}` template, so exact equality can never hold. The seam exists
   * for that; the default stays exact.
   */
  it("lets an adapter resolve a templated issuer", async () => {
    await install({
      discoveryOverrides: { issuer: `${ISSUER}/{tenantid}/v2.0` },
    });
    const adapter = adapterFor(idp, {
      validateIssuer: ({ discovered, actual, claims }) =>
        discovered.replace("{tenantid}", String(claims.tid)) === actual,
    });
    const idToken = await idp.signIdToken(
      baseClaims({ iss: `${ISSUER}/tenant-abc/v2.0`, tid: "tenant-abc" })
    );
    await expect(
      adapter.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).resolves.toMatchObject({ providerAccountId: "subject-1" });
  });

  it("still rejects when the resolved issuer does not match", async () => {
    await install({
      discoveryOverrides: { issuer: `${ISSUER}/{tenantid}/v2.0` },
    });
    const adapter = adapterFor(idp, {
      validateIssuer: ({ discovered, actual, claims }) =>
        discovered.replace("{tenantid}", String(claims.tid)) === actual,
    });
    const idToken = await idp.signIdToken(
      baseClaims({
        iss: `${ISSUER}/tenant-abc/v2.0`,
        tid: "a-different-tenant",
      })
    );
    await expect(
      adapter.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).rejects.toThrow(/not accepted/);
  });
});

describe("assertClaims", () => {
  it("runs after verification and can reject", async () => {
    const adapter = adapterFor(idp, {
      assertClaims: () => {
        throw new SsoError("domain-not-allowed", "test");
      },
    });
    const idToken = await idp.signIdToken(baseClaims());
    await expect(
      adapter.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).rejects.toMatchObject({ reason: "domain-not-allowed" });
  });

  it("is not reached when the signature is bad", async () => {
    const assertClaims = vi.fn();
    const adapter = adapterFor(idp, { assertClaims });
    const foreign = await idp.signWithForeignKey(baseClaims());
    await expect(
      adapter.toProfile(
        { accessToken: "at", idToken: foreign },
        { nonce: "nonce-1" }
      )
    ).rejects.toBeInstanceOf(SsoError);
    expect(assertClaims).not.toHaveBeenCalled();
  });
});
