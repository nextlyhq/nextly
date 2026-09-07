import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GoogleProviderOptions } from "../../config";
import { createGoogleAdapter } from "../google";
import { DiscoveryCache } from "../oidc";

import { baseClaims, createFakeIdp, type FakeIdp } from "./fake-idp";

/** The adapter hardcodes this, so the fake answers on it. */
const GOOGLE_ISSUER = "https://accounts.google.com";

const options: GoogleProviderOptions = {
  clientId: "client-id",
  clientSecret: "client-secret",
};

let idp: FakeIdp;

function adapter(over: Partial<GoogleProviderOptions> = {}) {
  return createGoogleAdapter(
    { ...options, ...over },
    // A cache per adapter, so discovery in one test cannot satisfy another.
    { cache: new DiscoveryCache() }
  );
}

function googleClaims(over: Record<string, unknown> = {}) {
  return baseClaims({ iss: GOOGLE_ISSUER, ...over });
}

beforeEach(async () => {
  idp = await createFakeIdp({ issuer: GOOGLE_ISSUER });
  vi.stubGlobal("fetch", idp.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scopes", () => {
  it("requests only what the linking rules and the admin UI consult", () => {
    expect(adapter().scopes).toEqual(["openid", "email", "profile"]);
  });

  it("appends configured extra scopes", () => {
    expect(adapter({ extraScopes: ["drive.readonly"] }).scopes).toEqual([
      "openid",
      "email",
      "profile",
      "drive.readonly",
    ]);
  });
});

describe("profile", () => {
  async function profile(claims: Record<string, unknown>, a = adapter()) {
    const idToken = await idp.signIdToken(googleClaims(claims));
    return a.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" });
  }

  /** `sub` survives an address change; `email` does not. */
  it("keys the identity on sub, not email", async () => {
    await expect(
      profile({ sub: "google-uid-9", email: "a@b.test" })
    ).resolves.toMatchObject({
      providerAccountId: "google-uid-9",
    });
  });

  it("carries the verified flag through", async () => {
    await expect(profile({ email_verified: true })).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  /**
   * Carried, not refused, at this layer. The adapter reports what the provider
   * asserted; refusing to LINK on an unverified address is the linking rules'
   * decision, and putting it here would make it unenforceable for any provider
   * whose adapter forgot.
   */
  it("reports an unverified address as unverified rather than failing", async () => {
    await expect(profile({ email_verified: false })).resolves.toMatchObject({
      emailVerified: false,
      email: "person@example.com",
    });
  });

  it("treats an absent email_verified claim as unverified", async () => {
    const claims = googleClaims();
    delete claims.email_verified;
    const idToken = await idp.signIdToken(claims);
    await expect(
      adapter().toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).resolves.toMatchObject({ emailVerified: false });
  });

  it("tolerates a token carrying no email", async () => {
    const claims = googleClaims();
    delete claims.email;
    const idToken = await idp.signIdToken(claims);
    await expect(
      adapter().toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).resolves.toMatchObject({ email: null, emailVerified: false });
  });

  it("rejects a token with no sub", async () => {
    const claims = googleClaims();
    delete claims.sub;
    const idToken = await idp.signIdToken(claims);
    await expect(
      adapter().toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" })
    ).rejects.toMatchObject({ reason: "id-token-invalid" });
  });

  it("passes the display name and picture through", async () => {
    await expect(
      profile({ name: "Ada L", picture: "https://img.test/a.png" })
    ).resolves.toMatchObject({
      name: "Ada L",
      image: "https://img.test/a.png",
    });
  });
});

describe("hosted-domain restriction", () => {
  async function attempt(
    claims: Record<string, unknown>,
    hostedDomains?: string[]
  ) {
    const a = hostedDomains ? adapter({ hostedDomains }) : adapter();
    const idToken = await idp.signIdToken(googleClaims(claims));
    return a.toProfile({ accessToken: "at", idToken }, { nonce: "nonce-1" });
  }

  it("admits any account when no domains are configured", async () => {
    await expect(attempt({})).resolves.toMatchObject({
      providerAccountId: "subject-1",
    });
  });

  it("admits an account whose hd claim is listed", async () => {
    await expect(
      attempt({ hd: "acme.com" }, ["acme.com"])
    ).resolves.toMatchObject({
      providerAccountId: "subject-1",
    });
  });

  it("refuses an account from an unlisted domain", async () => {
    await expect(
      attempt({ hd: "evil.test" }, ["acme.com"])
    ).rejects.toMatchObject({
      reason: "domain-not-allowed",
    });
  });

  /**
   * A personal Google account carries no `hd` at all, and can hold an address
   * ending in the corporate domain. Enforcing on the claim rather than the
   * email suffix is what separates the two.
   */
  it("refuses a personal account even when its address looks corporate", async () => {
    await expect(
      attempt({ email: "someone@acme.com" }, ["acme.com"])
    ).rejects.toMatchObject({ reason: "domain-not-allowed" });
  });

  it("admits any of several listed domains", async () => {
    await expect(
      attempt({ hd: "second.test" }, ["first.test", "second.test"])
    ).resolves.toMatchObject({ providerAccountId: "subject-1" });
  });
});

describe("authorize request", () => {
  const args = {
    state: "s",
    nonce: "n",
    challenge: "c",
    redirectUri: "https://app.test/cb",
  };

  it("preselects the account chooser when exactly one domain is configured", async () => {
    const url = new URL(
      await adapter({ hostedDomains: ["acme.com"] }).buildAuthorizeUrl(args)
    );
    expect(url.searchParams.get("hd")).toBe("acme.com");
  });

  /** The parameter takes one value; sending the first would narrow the rest away. */
  it("omits hd when several domains are configured", async () => {
    const url = new URL(
      await adapter({ hostedDomains: ["a.test", "b.test"] }).buildAuthorizeUrl(
        args
      )
    );
    expect(url.searchParams.get("hd")).toBeNull();
  });

  it("targets Google's own authorization endpoint", async () => {
    const url = new URL(await adapter().buildAuthorizeUrl(args));
    expect(url.origin).toBe(GOOGLE_ISSUER);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_mode")).toBe("query");
  });
});
